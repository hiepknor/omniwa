use crate::client::{OmniwaClient, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{LIST_EVENTS, STREAM_EVENTS};
use crate::transport::{SdkResponse, Transport};

pub struct EventsClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> EventsClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(LIST_EVENTS, &[], &[], None, RequestOptions::default())
    }

    pub fn stream(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(STREAM_EVENTS, &[], &[], None, RequestOptions::default())
    }
}
