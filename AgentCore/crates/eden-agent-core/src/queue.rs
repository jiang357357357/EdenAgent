use crate::Message;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum QueueMode {
    All,
    #[default]
    OneAtATime,
}

#[derive(Clone, Debug)]
pub struct PendingMessageQueue {
    mode: QueueMode,
    messages: Arc<Mutex<VecDeque<Message>>>,
}

impl PendingMessageQueue {
    pub fn new(mode: QueueMode) -> Self {
        Self {
            mode,
            messages: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub fn enqueue(&self, message: Message) {
        self.lock().push_back(message);
    }

    pub fn has_items(&self) -> bool {
        !self.lock().is_empty()
    }

    pub fn drain(&self) -> Vec<Message> {
        let mut messages = self.lock();
        match self.mode {
            QueueMode::All => messages.drain(..).collect(),
            QueueMode::OneAtATime => messages.pop_front().into_iter().collect(),
        }
    }

    pub fn clear(&self) {
        self.lock().clear();
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<Message>> {
        self.messages.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
