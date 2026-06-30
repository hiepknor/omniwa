use crate::client::{OmniwaClient, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{GET_JOB, LIST_JOBS};
use crate::transport::{SdkResponse, Transport};

pub struct JobsClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> JobsClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(LIST_JOBS, &[], &[], None, RequestOptions::default())
    }

    pub fn get(&self, job_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_JOB,
            &[("jobId", job_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }
}
