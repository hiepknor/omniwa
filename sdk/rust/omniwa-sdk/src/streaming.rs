use crate::error::SdkError;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SseEvent {
    pub id: Option<String>,
    pub event: Option<String>,
    pub data: String,
}

pub fn parse_sse_events(input: &str) -> Result<Vec<SseEvent>, SdkError> {
    let mut events = Vec::new();
    let mut current = SseEvent::default();

    for line in input.lines() {
        if line.is_empty() {
            if current.id.is_some() || current.event.is_some() || !current.data.is_empty() {
                events.push(current);
                current = SseEvent::default();
            }

            continue;
        }

        if line.starts_with(':') {
            continue;
        }

        if let Some(value) = line.strip_prefix("id:") {
            current.id = Some(value.trim().to_owned());
            continue;
        }

        if let Some(value) = line.strip_prefix("event:") {
            current.event = Some(value.trim().to_owned());
            continue;
        }

        if let Some(value) = line.strip_prefix("data:") {
            if !current.data.is_empty() {
                current.data.push('\n');
            }

            current.data.push_str(value.trim_start());
            continue;
        }

        return Err(SdkError::invalid_request("Unsupported SSE field."));
    }

    if current.id.is_some() || current.event.is_some() || !current.data.is_empty() {
        events.push(current);
    }

    Ok(events)
}
