use serde_json::Value;
use std::fmt::{Display, Formatter};

use crate::tool::ToolDefinition;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidationError(pub String);

impl Display for ValidationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ValidationError {}

/// Validate the portable contract used for function-tool input schemas.
///
/// Although an empty JSON Schema (`{}`) is valid JSON Schema, OpenAI-compatible
/// function-calling APIs do not agree on whether it is accepted. MonAgent uses
/// the strict common denominator: every function receives one JSON object and
/// declares its properties explicitly.
pub fn validate_tool_parameters_schema(tool_name: &str, schema: &Value) -> Result<(), ValidationError> {
    let object = schema
        .as_object()
        .ok_or_else(|| ValidationError(format!("tool {tool_name} parameters must be a JSON Schema object")))?;
    if object.get("type").and_then(Value::as_str) != Some("object") {
        return Err(ValidationError(format!(
            "tool {tool_name} parameters must declare root type \"object\""
        )));
    }
    let properties = object
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| ValidationError(format!("tool {tool_name} parameters must declare object properties")))?;
    if let Some(required) = object.get("required") {
        let required = required
            .as_array()
            .ok_or_else(|| ValidationError(format!("tool {tool_name} parameters.required must be an array")))?;
        for name in required {
            let name = name.as_str().ok_or_else(|| {
                ValidationError(format!(
                    "tool {tool_name} parameters.required must contain only strings"
                ))
            })?;
            if !properties.contains_key(name) {
                return Err(ValidationError(format!(
                    "tool {tool_name} requires undeclared property {name}"
                )));
            }
        }
    }
    Ok(())
}

pub fn validate_tool_definitions(tools: &[ToolDefinition]) -> Result<(), ValidationError> {
    for tool in tools {
        validate_tool_parameters_schema(&tool.name, &tool.parameters)?;
    }
    Ok(())
}

fn matches_type(value: &Value, expected: &str) -> bool {
    match expected {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "number" => value.is_number(),
        "null" => value.is_null(),
        _ => true,
    }
}

pub fn validate_json_schema(value: &Value, schema: &Value, path: &str) -> Result<(), ValidationError> {
    let Some(schema) = schema.as_object() else {
        return Ok(());
    };
    if let Some(alternatives) = schema.get("anyOf").and_then(Value::as_array) {
        let alternatives: Vec<_> = alternatives.iter().filter(|value| value.is_object()).collect();
        if !alternatives.is_empty()
            && !alternatives
                .iter()
                .any(|alternative| validate_json_schema(value, alternative, path).is_ok())
        {
            return Err(ValidationError(format!(
                "{path} must match at least one allowed schema"
            )));
        }
    }
    let expected: Vec<&str> = match schema.get("type") {
        Some(Value::String(value)) => vec![value],
        Some(Value::Array(values)) => values.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    if !expected.is_empty() && !expected.iter().any(|kind| matches_type(value, kind)) {
        return Err(ValidationError(format!("{path} must be {}", expected.join(" or "))));
    }
    if let Some(values) = schema.get("enum").and_then(Value::as_array)
        && !values.contains(value)
    {
        return Err(ValidationError(format!(
            "{path} must be one of {}",
            Value::Array(values.clone())
        )));
    }
    if let Some(object) = value.as_object() {
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            for name in required.iter().filter_map(Value::as_str) {
                if !object.contains_key(name) {
                    return Err(ValidationError(format!("{path}.{name} is required")));
                }
            }
        }
        let properties = schema.get("properties").and_then(Value::as_object);
        for (name, item) in object {
            if let Some(child_schema) = properties.and_then(|properties| properties.get(name)) {
                validate_json_schema(item, child_schema, &format!("{path}.{name}"))?;
            } else if schema.get("additionalProperties") == Some(&Value::Bool(false)) {
                return Err(ValidationError(format!("{path}.{name} is not allowed")));
            }
        }
    }
    if let Some(array) = value.as_array() {
        if let Some(minimum) = schema.get("minItems").and_then(Value::as_u64)
            && array.len() < minimum as usize
        {
            return Err(ValidationError(format!(
                "{path} must contain at least {minimum} item(s)"
            )));
        }
        if let Some(maximum) = schema.get("maxItems").and_then(Value::as_u64)
            && array.len() > maximum as usize
        {
            return Err(ValidationError(format!(
                "{path} must contain at most {maximum} item(s)"
            )));
        }
        if let Some(item_schema) = schema.get("items").filter(|value| value.is_object()) {
            for (index, item) in array.iter().enumerate() {
                validate_json_schema(item, item_schema, &format!("{path}[{index}]"))?;
            }
        }
    }
    if let Some(text) = value.as_str() {
        let length = text.chars().count();
        if let Some(minimum) = schema.get("minLength").and_then(Value::as_u64)
            && length < minimum as usize
        {
            return Err(ValidationError(format!("{path} is too short")));
        }
        if let Some(maximum) = schema.get("maxLength").and_then(Value::as_u64)
            && length > maximum as usize
        {
            return Err(ValidationError(format!("{path} is too long")));
        }
    }
    if let Some(number) = value.as_f64() {
        for (key, comparison, wording) in [
            (
                "minimum",
                number
                    < schema
                        .get("minimum")
                        .and_then(Value::as_f64)
                        .unwrap_or(f64::NEG_INFINITY),
                "at least",
            ),
            (
                "exclusiveMinimum",
                number
                    <= schema
                        .get("exclusiveMinimum")
                        .and_then(Value::as_f64)
                        .unwrap_or(f64::NEG_INFINITY),
                "greater than",
            ),
            (
                "maximum",
                number > schema.get("maximum").and_then(Value::as_f64).unwrap_or(f64::INFINITY),
                "at most",
            ),
            (
                "exclusiveMaximum",
                number
                    >= schema
                        .get("exclusiveMaximum")
                        .and_then(Value::as_f64)
                        .unwrap_or(f64::INFINITY),
                "less than",
            ),
        ] {
            if schema.contains_key(key) && comparison {
                return Err(ValidationError(format!("{path} must be {wording} {}", schema[key])));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_the_agent_core_schema_subset() {
        let schema = json!({
            "type": "object",
            "properties": {
                "name": {"type": "string", "minLength": 2},
                "items": {"type": "array", "minItems": 1, "items": {"type": "integer"}}
            },
            "required": ["name"],
            "additionalProperties": false
        });
        assert!(validate_json_schema(&json!({"name": "ok", "items": [1]}), &schema, "arguments").is_ok());
        assert_eq!(
            validate_json_schema(&json!({"name": "x"}), &schema, "arguments")
                .expect_err("invalid")
                .0,
            "arguments.name is too short"
        );
        assert_eq!(
            validate_json_schema(&json!({"name": "ok", "extra": true}), &schema, "arguments")
                .expect_err("extra property is invalid")
                .0,
            "arguments.extra is not allowed"
        );
    }

    #[test]
    fn function_tool_parameters_require_an_explicit_object_schema() {
        assert!(validate_tool_parameters_schema("ok", &json!({"type":"object","properties":{}})).is_ok());
        for invalid in [
            Value::Null,
            json!({}),
            json!({"type":"array","items":{}}),
            json!({"type":"object"}),
            json!({"type":"object","properties":{},"required":["missing"]}),
        ] {
            assert!(validate_tool_parameters_schema("invalid", &invalid).is_err());
        }
    }
}
