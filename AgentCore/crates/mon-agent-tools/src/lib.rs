//! Native filesystem tools used by the Mon agent runtime.

mod common;
mod diff;
mod mutation;
mod patch;
mod read;
mod search;
mod shell;
mod skills;

use mon_agent_core::{Tool, ToolDefinition};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub use diff::GetDiffTool;
pub use mutation::{EditTool, WriteTool};
pub use patch::ApplyPatchTool;
pub use read::{LsTool, ReadTool};
pub use search::{FindTool, GrepTool};
pub use shell::{BashTool, PowerShellTool, WriteStdinTool};
pub use skills::load_skills;

pub const NATIVE_TOOL_NAMES: &[&str] = &[
    "read",
    "ls",
    "find",
    "grep",
    "write",
    "edit",
    "apply_patch",
    "bash",
    "powershell",
    "write_stdin",
    "get_diff",
];

#[derive(Clone)]
pub struct NativeToolConfig {
    workspace_root: PathBuf,
    allow_outside_cwd: bool,
    auto_images: bool,
    process_registry: shell::ProcessRegistry,
}

impl NativeToolConfig {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            allow_outside_cwd: false,
            auto_images: true,
            process_registry: shell::ProcessRegistry::new(),
        }
    }

    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    pub fn with_allow_outside_cwd(mut self, allow: bool) -> Self {
        self.allow_outside_cwd = allow;
        self
    }

    pub fn with_auto_images(mut self, enabled: bool) -> Self {
        self.auto_images = enabled;
        self
    }
}

pub fn supports_native_tool(name: &str) -> bool {
    NATIVE_TOOL_NAMES.contains(&name)
}

/// Preserve the Server-provided definition while replacing only execution.
pub fn create_native_tool(definition: ToolDefinition, config: NativeToolConfig) -> Option<Arc<dyn Tool>> {
    let tool: Arc<dyn Tool> = match definition.name.as_str() {
        "read" => Arc::new(ReadTool::new(definition, config)),
        "ls" => Arc::new(LsTool::new(definition, config)),
        "find" => Arc::new(FindTool::new(definition, config)),
        "grep" => Arc::new(GrepTool::new(definition, config)),
        "write" => Arc::new(WriteTool::new(definition, config)),
        "edit" => Arc::new(EditTool::new(definition, config)),
        "apply_patch" => Arc::new(ApplyPatchTool::new(definition, config)),
        "bash" => Arc::new(BashTool::new(definition, config)),
        "powershell" => Arc::new(PowerShellTool::new(definition, config)),
        "write_stdin" => Arc::new(WriteStdinTool::new(definition, config)),
        "get_diff" => Arc::new(GetDiffTool::new(definition, config)),
        _ => return None,
    };
    Some(tool)
}
