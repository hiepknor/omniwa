use crate::client::{OmniwaClient, RequestBody, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{
    CONNECT_INSTANCE, CREATE_INSTANCE, DESTROY_INSTANCE, DISCONNECT_INSTANCE, GET_INSTANCE,
    LIST_INSTANCES, LIST_INSTANCE_SESSIONS, REFRESH_INSTANCE_QR, UPDATE_INSTANCE,
};
use crate::transport::{SdkResponse, Transport};

pub struct InstancesClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> InstancesClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(LIST_INSTANCES, &[], &[], None, RequestOptions::default())
    }

    pub fn get(&self, instance_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_INSTANCE,
            &[("instanceId", instance_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn list_sessions(&self, instance_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_INSTANCE_SESSIONS,
            &[("instanceId", instance_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn create_json(
        &self,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            CREATE_INSTANCE,
            &[],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn update_json(
        &self,
        instance_id: &str,
        body: impl Into<String>,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            UPDATE_INSTANCE,
            &[("instanceId", instance_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            RequestOptions::default(),
        )
    }

    pub fn destroy(
        &self,
        instance_id: &str,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            DESTROY_INSTANCE,
            &[("instanceId", instance_id)],
            &[],
            None,
            options,
        )
    }

    pub fn connect_json(
        &self,
        instance_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            CONNECT_INSTANCE,
            &[("instanceId", instance_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn disconnect_json(
        &self,
        instance_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            DISCONNECT_INSTANCE,
            &[("instanceId", instance_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn refresh_qr_json(
        &self,
        instance_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            REFRESH_INSTANCE_QR,
            &[("instanceId", instance_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }
}
