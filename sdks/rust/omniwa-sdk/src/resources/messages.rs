use crate::client::{OmniwaClient, RequestBody, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{
    CANCEL_MESSAGE, GET_MESSAGE, GET_MESSAGE_DELIVERY_HISTORY, LIST_INSTANCE_MESSAGES,
    RETRY_MESSAGE, SEND_INSTANCE_MEDIA_MESSAGE, SEND_INSTANCE_MESSAGE, SEND_INSTANCE_TEXT_MESSAGE,
};
use crate::transport::{SdkResponse, Transport};

pub struct MessagesClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> MessagesClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list_for_instance(&self, instance_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_INSTANCE_MESSAGES,
            &[("instanceId", instance_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn send_json(
        &self,
        instance_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            SEND_INSTANCE_MESSAGE,
            &[("instanceId", instance_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn send_text_json(
        &self,
        instance_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            SEND_INSTANCE_TEXT_MESSAGE,
            &[("instanceId", instance_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn send_media_json(
        &self,
        instance_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            SEND_INSTANCE_MEDIA_MESSAGE,
            &[("instanceId", instance_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn get(&self, message_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_MESSAGE,
            &[("messageId", message_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn delivery_history(&self, message_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_MESSAGE_DELIVERY_HISTORY,
            &[("messageId", message_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn retry_json(
        &self,
        message_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            RETRY_MESSAGE,
            &[("messageId", message_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn cancel_json(
        &self,
        message_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            CANCEL_MESSAGE,
            &[("messageId", message_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }
}
