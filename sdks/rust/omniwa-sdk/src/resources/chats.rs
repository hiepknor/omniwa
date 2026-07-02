use crate::client::{OmniwaClient, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{GET_CHAT, LIST_CHATS, LIST_INSTANCE_CHATS};
use crate::transport::{SdkResponse, Transport};

pub struct ChatsClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> ChatsClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(LIST_CHATS, &[], &[], None, RequestOptions::default())
    }

    pub fn list_for_instance(&self, instance_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_INSTANCE_CHATS,
            &[("instanceId", instance_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn get(&self, chat_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_CHAT,
            &[("chatId", chat_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }
}
