use crate::client::{OmniwaClient, RequestBody, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{
    BULK_REDRIVE_WEBHOOK_DELIVERIES, GET_WEBHOOK, GET_WEBHOOK_DELIVERY_HISTORY, LIST_WEBHOOKS,
    LIST_WEBHOOK_DELIVERIES, REDRIVE_WEBHOOK_DELIVERY, RETRY_WEBHOOK_DELIVERY,
};
use crate::transport::{SdkResponse, Transport};

pub struct WebhooksClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> WebhooksClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Result<SdkResponse, SdkError> {
        self.client
            .execute(LIST_WEBHOOKS, &[], &[], None, RequestOptions::default())
    }

    pub fn get(&self, webhook_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_WEBHOOK,
            &[("webhookId", webhook_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn list_deliveries(&self) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_WEBHOOK_DELIVERIES,
            &[],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn list_dead_letter_deliveries(&self) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_WEBHOOK_DELIVERIES,
            &[],
            &[("status", "dead_letter")],
            None,
            RequestOptions::default(),
        )
    }

    pub fn delivery_history(&self, delivery_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_WEBHOOK_DELIVERY_HISTORY,
            &[("deliveryId", delivery_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn retry_delivery_json(
        &self,
        delivery_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            RETRY_WEBHOOK_DELIVERY,
            &[("deliveryId", delivery_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn redrive_delivery_json(
        &self,
        delivery_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            REDRIVE_WEBHOOK_DELIVERY,
            &[("deliveryId", delivery_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn redrive_deliveries_json(
        &self,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            BULK_REDRIVE_WEBHOOK_DELIVERIES,
            &[],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }
}
