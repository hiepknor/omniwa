use crate::client::{OmniwaClient, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{GET_HEALTH, GET_HEALTH_READINESS};
use crate::transport::{SdkResponse, Transport};

pub struct HealthClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> HealthClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn get(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(GET_HEALTH, &[], &[], None, RequestOptions::default())
    }

    pub fn readiness(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(GET_HEALTH_READINESS, &[], &[], None, RequestOptions::default())
    }
}
