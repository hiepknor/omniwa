use crate::client::{OmniwaClient, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{GET_LABEL, LIST_INSTANCE_LABELS, LIST_LABELS};
use crate::transport::{SdkResponse, Transport};

pub struct LabelsClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> LabelsClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(LIST_LABELS, &[], &[], None, RequestOptions::default())
    }

    pub fn list_for_instance(&self, instance_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_INSTANCE_LABELS,
            &[("instanceId", instance_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn get(&self, label_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_LABEL,
            &[("labelId", label_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }
}
