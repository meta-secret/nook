//! Generic causal DAG indexing for immutable replicated events.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;

/// Result of indexing an immutable event and its parent set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CausalInsertStatus<Id> {
    Applied,
    Pending { missing_parents: Vec<Id> },
    Quarantined { reason: String },
    Duplicate,
    Conflict,
}

/// Structural causal-graph failures independent of an application's event
/// schema or authorization policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CausalGraphError {
    Cycle,
    TopologicalSortStalled,
}

impl fmt::Display for CausalGraphError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cycle => formatter.write_str("causal graph contains a cycle"),
            Self::TopologicalSortStalled => {
                formatter.write_str("failed to advance causal topological sort")
            }
        }
    }
}

impl Error for CausalGraphError {}

/// Provider-neutral causal metadata for an immutable event set.
///
/// The application owns event bytes, signatures, authorization, and domain
/// projection. This index owns only parent relationships and rejection
/// propagation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CausalGraph<Id> {
    parents: BTreeMap<Id, Vec<Id>>,
    quarantined: BTreeMap<Id, String>,
}

impl<Id> Default for CausalGraph<Id> {
    fn default() -> Self {
        Self {
            parents: BTreeMap::new(),
            quarantined: BTreeMap::new(),
        }
    }
}

impl<Id> CausalGraph<Id>
where
    Id: Clone + Ord,
{
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.parents.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.parents.is_empty()
    }

    #[must_use]
    pub fn contains(&self, id: &Id) -> bool {
        self.parents.contains_key(id)
    }

    #[must_use]
    pub fn parents(&self, id: &Id) -> Option<&[Id]> {
        self.parents.get(id).map(Vec::as_slice)
    }

    #[must_use]
    pub fn quarantined(&self) -> &BTreeMap<Id, String> {
        &self.quarantined
    }

    pub fn insert(&mut self, id: Id, parents: impl Into<Vec<Id>>) -> CausalInsertStatus<Id> {
        let parents = Self::normalize_parents(parents.into());
        if let Some(existing) = self.parents.get_mut(&id) {
            if existing == &parents {
                return CausalInsertStatus::Duplicate;
            }
            if parents < *existing {
                existing.clone_from(&parents);
            }
            self.merge_quarantine_reason(
                id,
                "Conflicting causal parent sets for the same event id".to_owned(),
            );
            self.propagate_quarantine();
            return CausalInsertStatus::Conflict;
        }
        let missing_parents = parents
            .iter()
            .filter(|parent| !self.parents.contains_key(*parent))
            .cloned()
            .collect::<Vec<_>>();
        self.parents.insert(id.clone(), parents.clone());
        self.propagate_quarantine();
        if let Some(reason) = self.quarantined.get(&id) {
            CausalInsertStatus::Quarantined {
                reason: reason.clone(),
            }
        } else if self.ancestor_ids_present(&parents) {
            CausalInsertStatus::Applied
        } else {
            CausalInsertStatus::Pending { missing_parents }
        }
    }

    pub fn quarantine(&mut self, id: Id, reason: String) {
        self.merge_quarantine_reason(id, reason);
        self.propagate_quarantine();
    }

    #[must_use]
    pub fn ancestors_present(&self, id: &Id) -> bool {
        let Some(parents) = self.parents.get(id) else {
            return false;
        };
        self.ancestor_ids_present(parents)
    }

    #[must_use]
    pub fn ancestor_ids_present(&self, parents: &[Id]) -> bool {
        let mut visited = BTreeSet::new();
        let mut stack = parents.to_vec();
        while let Some(id) = stack.pop() {
            if !visited.insert(id.clone()) {
                continue;
            }
            let Some(parent_ids) = self.parents.get(&id) else {
                return false;
            };
            stack.extend(parent_ids.iter().cloned());
        }
        true
    }

    #[must_use]
    pub fn applicable_ids(&self) -> Vec<&Id> {
        self.parents
            .keys()
            .filter(|id| !self.quarantined.contains_key(*id) && self.ancestors_present(*id))
            .collect()
    }

    #[must_use]
    pub fn pending_ids(&self) -> Vec<&Id> {
        self.parents
            .iter()
            .filter(|(id, parents)| {
                !parents.is_empty()
                    && !self.ancestor_ids_present(parents)
                    && !self.quarantined.contains_key(*id)
            })
            .map(|(id, _)| id)
            .collect()
    }

    #[must_use]
    pub fn heads(&self) -> Vec<Id> {
        let mut referenced = BTreeSet::new();
        for (id, parents) in &self.parents {
            if self.quarantined.contains_key(id) {
                continue;
            }
            referenced.extend(parents.iter().cloned());
        }
        self.parents
            .keys()
            .filter(|id| !self.quarantined.contains_key(*id) && !referenced.contains(*id))
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn is_ancestor(&self, ancestor: &Id, descendant: &Id) -> bool {
        if ancestor == descendant {
            return true;
        }
        let Some(parents) = self.parents.get(descendant) else {
            return false;
        };
        let mut visited = BTreeSet::new();
        let mut stack = parents.clone();
        while let Some(id) = stack.pop() {
            if &id == ancestor {
                return true;
            }
            if !visited.insert(id.clone()) {
                continue;
            }
            if let Some(parent_ids) = self.parents.get(&id) {
                stack.extend(parent_ids.iter().cloned());
            }
        }
        false
    }

    #[must_use]
    pub fn are_concurrent(&self, left: &Id, right: &Id) -> bool {
        left != right
            && !self.is_ancestor(left, right)
            && !self.is_ancestor(right, left)
            && self.parents.contains_key(left)
            && self.parents.contains_key(right)
    }

    /// Deterministic topological order with identifiers as the tie-break.
    pub fn topological_order(&self) -> Result<Vec<Id>, CausalGraphError> {
        let mut ordered = Vec::with_capacity(self.parents.len());
        let mut remaining: BTreeSet<Id> = self.applicable_ids().into_iter().cloned().collect();

        while !remaining.is_empty() {
            let ready = remaining
                .iter()
                .filter(|id| {
                    self.parents
                        .get(*id)
                        .expect("remaining identifiers are indexed")
                        .iter()
                        .all(|parent| ordered.contains(parent) || !remaining.contains(parent))
                })
                .cloned()
                .collect::<Vec<_>>();
            if ready.is_empty() {
                return Err(CausalGraphError::Cycle);
            }
            let previous_len = remaining.len();
            for id in ready {
                remaining.remove(&id);
                ordered.push(id);
            }
            if remaining.len() == previous_len {
                return Err(CausalGraphError::TopologicalSortStalled);
            }
        }
        Ok(ordered)
    }

    #[must_use]
    pub fn union(&self, other: &Self) -> Self {
        let mut merged = self.clone();
        for (id, parents) in &other.parents {
            let parents = Self::normalize_parents(parents.clone());
            match merged.parents.get_mut(id) {
                Some(existing) if existing != &parents => {
                    if parents < *existing {
                        existing.clone_from(&parents);
                    }
                    merged.merge_quarantine_reason(
                        id.clone(),
                        "Conflicting causal parent sets for the same event id".to_owned(),
                    );
                }
                Some(_) => {}
                None => {
                    merged.parents.insert(id.clone(), parents);
                }
            }
        }
        for (id, reason) in &other.quarantined {
            merged.merge_quarantine_reason(id.clone(), reason.clone());
        }
        merged.propagate_quarantine();
        merged
    }

    fn normalize_parents(mut parents: Vec<Id>) -> Vec<Id> {
        parents.sort();
        parents.dedup();
        parents
    }

    fn merge_quarantine_reason(&mut self, id: Id, reason: String) {
        self.quarantined
            .entry(id)
            .and_modify(|existing| {
                if reason < *existing {
                    existing.clone_from(&reason);
                }
            })
            .or_insert(reason);
    }

    fn propagate_quarantine(&mut self) {
        loop {
            let rejected_descendants = self
                .parents
                .iter()
                .filter(|(id, parents)| {
                    !self.quarantined.contains_key(*id)
                        && parents
                            .iter()
                            .any(|parent| self.quarantined.contains_key(parent))
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            if rejected_descendants.is_empty() {
                return;
            }
            for id in rejected_descendants {
                self.quarantined
                    .insert(id, "Ancestor event was rejected".to_owned());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> String {
        value.to_owned()
    }

    #[test]
    fn pending_child_becomes_applicable_when_parent_arrives() {
        let mut graph = CausalGraph::new();
        assert_eq!(
            graph.insert(id("child"), vec![id("root")]),
            CausalInsertStatus::Pending {
                missing_parents: vec![id("root")]
            }
        );
        assert_eq!(graph.pending_ids(), vec![&id("child")]);

        assert_eq!(
            graph.insert(id("root"), Vec::new()),
            CausalInsertStatus::Applied
        );
        assert!(graph.pending_ids().is_empty());
        assert_eq!(
            graph.topological_order().unwrap(),
            vec![id("root"), id("child")]
        );
    }

    #[test]
    fn descendant_stays_pending_until_transitive_ancestor_arrives() {
        let mut graph = CausalGraph::new();
        assert!(matches!(
            graph.insert(id("parent"), vec![id("root")]),
            CausalInsertStatus::Pending { .. }
        ));
        assert_eq!(
            graph.insert(id("child"), vec![id("parent")]),
            CausalInsertStatus::Pending {
                missing_parents: Vec::new()
            }
        );
        assert_eq!(graph.pending_ids(), vec![&id("child"), &id("parent")]);

        graph.insert(id("root"), Vec::new());
        assert!(graph.pending_ids().is_empty());
    }

    #[test]
    fn direct_insertion_quarantines_conflicting_parent_sets_deterministically() {
        let mut left = CausalGraph::new();
        left.insert(id("a"), Vec::new());
        left.insert(id("b"), Vec::new());
        left.insert(id("same"), vec![id("a")]);
        assert_eq!(
            left.insert(id("same"), vec![id("b")]),
            CausalInsertStatus::Conflict
        );

        let mut right = CausalGraph::new();
        right.insert(id("a"), Vec::new());
        right.insert(id("b"), Vec::new());
        right.insert(id("same"), vec![id("b")]);
        assert_eq!(
            right.insert(id("same"), vec![id("a")]),
            CausalInsertStatus::Conflict
        );

        assert_eq!(left, right);
        assert!(left.quarantined().contains_key("same"));
        assert_eq!(left.parents(&id("same")), Some([id("a")].as_slice()));
    }

    #[test]
    fn parent_sets_are_normalized_before_duplicate_detection() {
        let mut graph = CausalGraph::new();
        graph.insert(id("a"), Vec::new());
        graph.insert(id("b"), Vec::new());
        graph.insert(id("same"), vec![id("b"), id("a"), id("b")]);

        assert_eq!(
            graph.insert(id("same"), vec![id("a"), id("b")]),
            CausalInsertStatus::Duplicate
        );
        assert_eq!(
            graph.parents(&id("same")),
            Some([id("a"), id("b")].as_slice())
        );
        assert!(!graph.quarantined().contains_key("same"));
    }

    #[test]
    fn concurrent_branches_and_join_have_deterministic_heads() {
        let mut graph = CausalGraph::new();
        graph.insert(id("root"), Vec::new());
        graph.insert(id("left"), vec![id("root")]);
        graph.insert(id("right"), vec![id("root")]);

        assert!(graph.are_concurrent(&id("left"), &id("right")));
        assert_eq!(graph.heads(), vec![id("left"), id("right")]);

        graph.insert(id("join"), vec![id("left"), id("right")]);
        assert_eq!(graph.heads(), vec![id("join")]);
    }

    #[test]
    fn quarantined_events_are_excluded_from_projection_order() {
        let mut graph = CausalGraph::new();
        graph.insert(id("root"), Vec::new());
        graph.insert(id("rejected"), vec![id("root")]);
        graph.insert(id("descendant"), vec![id("rejected")]);
        graph.quarantine(id("rejected"), "policy rejected".to_owned());
        graph.quarantine(id("descendant"), "ancestor rejected".to_owned());

        assert_eq!(graph.topological_order().unwrap(), vec![id("root")]);
        assert_eq!(graph.heads(), vec![id("root")]);
    }

    #[test]
    fn quarantine_propagates_through_indexed_and_future_descendants() {
        let mut graph = CausalGraph::new();
        graph.insert(id("root"), Vec::new());
        graph.insert(id("rejected"), vec![id("root")]);
        graph.insert(id("descendant"), vec![id("rejected")]);

        graph.quarantine(id("rejected"), id("invalid signature"));
        assert!(graph.quarantined().contains_key("descendant"));
        assert_eq!(graph.topological_order().unwrap(), vec![id("root")]);

        assert_eq!(
            graph.insert(id("future"), vec![id("descendant")]),
            CausalInsertStatus::Quarantined {
                reason: id("Ancestor event was rejected")
            }
        );
        assert!(graph.quarantined().contains_key("future"));
        assert_eq!(graph.topological_order().unwrap(), vec![id("root")]);
    }

    #[test]
    fn ancestry_queries_terminate_for_cycles() {
        let mut graph = CausalGraph::new();
        graph.insert(id("left"), vec![id("right")]);
        graph.insert(id("right"), vec![id("left")]);
        graph.insert(id("unrelated"), Vec::new());

        assert!(!graph.is_ancestor(&id("unrelated"), &id("left")));
        assert!(graph.is_ancestor(&id("right"), &id("left")));
        assert!(!graph.are_concurrent(&id("left"), &id("right")));
        assert_eq!(graph.topological_order(), Err(CausalGraphError::Cycle));
    }

    #[test]
    fn union_is_commutative_associative_and_idempotent() {
        let mut left = CausalGraph::new();
        left.insert(id("root"), Vec::new());
        left.insert(id("left"), vec![id("root")]);

        let mut right = CausalGraph::new();
        right.insert(id("root"), Vec::new());
        right.insert(id("right"), vec![id("root")]);

        let mut third = CausalGraph::new();
        third.insert(id("join"), vec![id("left"), id("right")]);

        assert_eq!(left.union(&right), right.union(&left));
        assert_eq!(
            left.union(&right).union(&third),
            left.union(&right.union(&third))
        );
        assert_eq!(left.union(&left), left);
    }

    #[test]
    fn union_quarantines_conflicting_parent_sets_commutatively() {
        let mut left = CausalGraph::new();
        left.insert(id("a"), Vec::new());
        left.insert(id("same"), vec![id("a")]);

        let mut right = CausalGraph::new();
        right.insert(id("b"), Vec::new());
        right.insert(id("same"), vec![id("b")]);

        let left_right = left.union(&right);
        let right_left = right.union(&left);
        assert_eq!(left_right, right_left);
        assert!(left_right.quarantined().contains_key("same"));
        assert_eq!(left_right.parents(&id("same")), Some([id("a")].as_slice()));
    }

    #[test]
    fn union_preserves_the_deterministic_minimum_quarantine_reason() {
        let mut left = CausalGraph::new();
        left.insert(id("a"), Vec::new());
        left.insert(id("b"), Vec::new());
        left.insert(id("same"), vec![id("a")]);
        left.quarantine(id("same"), id("A-policy"));

        let mut right = CausalGraph::new();
        right.insert(id("a"), Vec::new());
        right.insert(id("b"), Vec::new());
        right.insert(id("same"), vec![id("b")]);

        let left_right = left.union(&right);
        assert_eq!(left_right, right.union(&left));
        assert_eq!(
            left_right.quarantined().get("same").map(String::as_str),
            Some("A-policy")
        );
    }
}
