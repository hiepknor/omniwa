use crate::client::{OmniwaClient, RequestBody, RequestOptions};
use crate::error::SdkError;
use crate::generated::operations::{
    ADD_GROUP_MEMBER, DEMOTE_GROUP_MEMBER, GET_GROUP, LIST_GROUP_MEMBERS, LIST_INSTANCE_GROUPS,
    PROMOTE_GROUP_MEMBER, REFRESH_GROUP_INVITE_LINK, REFRESH_INSTANCE_GROUPS, REMOVE_GROUP_MEMBER,
    SEND_GROUP_TEXT_MESSAGE, UPDATE_GROUP, UPDATE_GROUP_LOCAL_STATE,
};
use crate::transport::{SdkResponse, Transport};

pub struct GroupsClient<'a, TTransport> {
    client: &'a OmniwaClient<TTransport>,
}

impl<'a, TTransport> GroupsClient<'a, TTransport>
where
    TTransport: Transport,
{
    pub(crate) fn new(client: &'a OmniwaClient<TTransport>) -> Self {
        Self { client }
    }

    pub fn list_for_instance(&self, instance_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_INSTANCE_GROUPS,
            &[("instanceId", instance_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn refresh_for_instance(
        &self,
        instance_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            REFRESH_INSTANCE_GROUPS,
            &[("instanceId", instance_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn get(&self, group_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            GET_GROUP,
            &[("groupId", group_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn list_members(&self, group_id: &str) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            LIST_GROUP_MEMBERS,
            &[("groupId", group_id)],
            &[],
            None,
            RequestOptions::default(),
        )
    }

    pub fn send_text_json(
        &self,
        group_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            SEND_GROUP_TEXT_MESSAGE,
            &[("groupId", group_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn update_json(
        &self,
        group_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            UPDATE_GROUP,
            &[("groupId", group_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn update_local_state_json(
        &self,
        group_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            UPDATE_GROUP_LOCAL_STATE,
            &[("groupId", group_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn add_member_json(
        &self,
        group_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            ADD_GROUP_MEMBER,
            &[("groupId", group_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn remove_member(
        &self,
        group_id: &str,
        member_jid: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            REMOVE_GROUP_MEMBER,
            &[("groupId", group_id), ("memberJid", member_jid)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn promote_member(
        &self,
        group_id: &str,
        member_jid: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            PROMOTE_GROUP_MEMBER,
            &[("groupId", group_id), ("memberJid", member_jid)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn demote_member(
        &self,
        group_id: &str,
        member_jid: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            DEMOTE_GROUP_MEMBER,
            &[("groupId", group_id), ("memberJid", member_jid)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }

    pub fn refresh_invite_link_json(
        &self,
        group_id: &str,
        body: impl Into<String>,
        options: RequestOptions,
    ) -> Result<SdkResponse, SdkError> {
        self.client.execute(
            REFRESH_GROUP_INVITE_LINK,
            &[("groupId", group_id)],
            &[],
            Some(RequestBody::Json(body.into())),
            options,
        )
    }
}
