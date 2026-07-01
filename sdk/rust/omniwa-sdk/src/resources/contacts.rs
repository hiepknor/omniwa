use crate::client::{OmniwaClient, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{GET_CONTACT, LIST_CONTACTS, LIST_INSTANCE_CONTACTS};
use crate::transport::{SdkResponse, Transport};

pub struct ContactsClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> ContactsClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(LIST_CONTACTS, &[], &[], None, RequestOptions::default())
    }

    pub fn list_for_instance(&self, instance_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_INSTANCE_CONTACTS,
            &[("instanceId", instance_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn get(&self, contact_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_CONTACT,
            &[("contactId", contact_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }
}
