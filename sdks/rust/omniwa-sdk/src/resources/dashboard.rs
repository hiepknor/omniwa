use crate::client::{OmniwaClient, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::GET_DASHBOARD_SUMMARY;
use crate::transport::{SdkResponse, Transport};

pub struct DashboardClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> DashboardClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn get(&self) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_DASHBOARD_SUMMARY,
            &[],
            &[],
            None,
            RequestOptions::default(),
        )
    }
}
