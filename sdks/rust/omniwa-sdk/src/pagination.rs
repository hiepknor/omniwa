#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub cursor: CursorPage,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CursorPage {
    pub next_cursor: Option<String>,
    pub previous_cursor: Option<String>,
    pub has_more: bool,
}

impl<T> Page<T> {
    pub fn new(items: Vec<T>, cursor: CursorPage) -> Self {
        Self { items, cursor }
    }
}
