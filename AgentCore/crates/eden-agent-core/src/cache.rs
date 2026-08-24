use crate::{ModelSpec, ToolDefinition};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const PROMPT_FINGERPRINT_VERSION: u32 = 1;

#[must_use]
pub fn prompt_prefix_state(model: &ModelSpec, system_prompt: &str, tools: &[ToolDefinition]) -> Value {
    let reasoning = model
        .extra
        .get("reasoning_effort")
        .or_else(|| model.extra.get("reasoning"))
        .cloned()
        .unwrap_or_else(|| json!("off"));
    let components = json!({
        "provider":model.provider,
        "model":model.id,
        "api":model.api,
        "reasoning":reasoning,
        "system":digest(&Value::String(system_prompt.to_owned())),
        "tools":digest(&serde_json::to_value(tools).unwrap_or_else(|_| json!([]))),
    });
    json!({
        "version":PROMPT_FINGERPRINT_VERSION,
        "fingerprint":digest(&json!({"version":PROMPT_FINGERPRINT_VERSION,"components":components})),
        "components":components,
    })
}

#[must_use]
pub fn advance_prompt_prefix(previous: Option<&Value>, current: Value) -> Value {
    let previous = previous.and_then(Value::as_object);
    let current_components = current
        .get("components")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let previous_components = previous
        .and_then(|value| value.get("components"))
        .and_then(Value::as_object);
    let keys = ["provider", "model", "api", "reasoning", "system", "tools"];
    let mut changed = keys
        .iter()
        .filter(|key| previous_components.and_then(|value| value.get(**key)) != current_components.get(**key))
        .map(|key| Value::String((*key).to_owned()))
        .collect::<Vec<_>>();
    let previous_fingerprint = previous.and_then(|value| value.get("fingerprint"));
    let current_fingerprint = current.get("fingerprint");
    let previous_epoch = previous
        .and_then(|value| value.get("epoch"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let (epoch, reason) = if previous_fingerprint.is_none() {
        (0, "initial".to_owned())
    } else if previous_fingerprint == current_fingerprint {
        changed.clear();
        (previous_epoch, "stable".to_owned())
    } else {
        (
            previous_epoch.saturating_add(1),
            changed.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(","),
        )
    };
    let mut state = current.as_object().cloned().unwrap_or_default();
    state.insert("epoch".to_owned(), json!(epoch));
    state.insert(
        "invalidationReason".to_owned(),
        Value::String(if reason.is_empty() {
            "fingerprint".to_owned()
        } else {
            reason
        }),
    );
    state.insert("changedComponents".to_owned(), Value::Array(changed));
    Value::Object(state)
}

fn digest(value: &Value) -> String {
    let canonical = canonicalize(value);
    let encoded = serde_json::to_vec(&canonical).unwrap_or_default();
    let bytes = Sha256::digest(encoded);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), canonicalize(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect::<Map<_, _>>(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(canonicalize).collect()),
        value => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str) -> ModelSpec {
        ModelSpec {
            id: id.to_owned(),
            provider: "openai".to_owned(),
            api: "responses".to_owned(),
            ..ModelSpec::default()
        }
    }

    #[test]
    fn fingerprint_is_stable_and_epoch_tracks_exact_invalidation() {
        let first = prompt_prefix_state(&model("m1"), "system", &[]);
        let initial = advance_prompt_prefix(None, first.clone());
        assert_eq!(initial["epoch"], 0);
        assert_eq!(initial["invalidationReason"], "initial");
        let stable = advance_prompt_prefix(Some(&initial), first);
        assert_eq!(stable["epoch"], 0);
        assert_eq!(stable["invalidationReason"], "stable");
        let changed = advance_prompt_prefix(Some(&stable), prompt_prefix_state(&model("m2"), "system", &[]));
        assert_eq!(changed["epoch"], 1);
        assert_eq!(changed["changedComponents"], json!(["model"]));
    }
}
