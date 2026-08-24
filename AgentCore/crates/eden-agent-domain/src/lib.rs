//! Stable domain identifiers shared by the embedded agent runtime and its host.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use ts_rs::TS;
use uuid::Uuid;

macro_rules! domain_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, TS)]
        #[serde(transparent)]
        #[ts(type = "string")]
        pub struct $name(Uuid);

        impl $name {
            #[must_use]
            pub fn new() -> Self {
                Self(Uuid::now_v7())
            }

            #[must_use]
            pub const fn from_uuid(value: Uuid) -> Self {
                Self(value)
            }

            #[must_use]
            pub const fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(value).map(Self)
            }
        }

        impl From<Uuid> for $name {
            fn from(value: Uuid) -> Self {
                Self(value)
            }
        }

        impl From<$name> for Uuid {
            fn from(value: $name) -> Self {
                value.0
            }
        }
    };
}

domain_id!(SessionId);
domain_id!(TurnId);
domain_id!(ItemId);
domain_id!(AgentId);
domain_id!(ToolCallId);
domain_id!(OperationId);
domain_id!(PermissionRequestId);
domain_id!(QuestionRequestId);
domain_id!(BlobId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip_as_transparent_strings() {
        let id = SessionId::new();
        let encoded = serde_json::to_string(&id).expect("serialize ID");
        assert_eq!(encoded, format!("\"{id}\""));
        assert_eq!(serde_json::from_str::<SessionId>(&encoded).expect("deserialize ID"), id);
    }
}
