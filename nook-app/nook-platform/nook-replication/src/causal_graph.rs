//! Generic causal DAG indexing for immutable replicated events.

mod union;
/// Causal membership distinguishes an unknown event from a recorded root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventParents<'a, Id> {
    UnknownEvent,
    Known(&'a [Id]),
}

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;

/// Number of immutable events indexed by a causal graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CausalGraphEventCount(usize);

impl CausalGraphEventCount {
    pub const EMPTY: Self = Self(0);
    pub const SINGLE_EVENT: Self = Self(1);
}

impl From<usize> for CausalGraphEventCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<CausalGraphEventCount> for usize {
    fn from(value: CausalGraphEventCount) -> Self {
        value.0
    }
}

/// Result of indexing an immutable event and its parent set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CausalInsertStatus<Id> {
    Applied,
    Pending { missing_parents: Vec<Id> },
    Quarantined { reason: String },
    Duplicate,
    Conflict,
}

pub struct CausalEventInsertion<Id> {
    pub id: Id,
    pub parents: Vec<Id>,
}
pub struct CausalQuarantine<Id> {
    pub id: Id,
    pub reason: String,
}
#[derive(Debug)]
pub struct CausalInsertion<Id> {
    pub graph: CausalGraph<Id>,
    pub status: CausalInsertStatus<Id>,
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
    quarantine_roots: BTreeMap<Id, String>,
    cyclic: BTreeSet<Id>,
    quarantined: BTreeMap<Id, String>,
}

impl<Id> Default for CausalGraph<Id> {
    fn default() -> Self {
        Self {
            parents: BTreeMap::new(),
            quarantine_roots: BTreeMap::new(),
            cyclic: BTreeSet::new(),
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
    pub fn len(&self) -> CausalGraphEventCount {
        CausalGraphEventCount(self.parents.len())
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
    pub fn parents(&self, id: &Id) -> EventParents<'_, Id> {
        match self.parents.get(id) {
            Some(parents) => EventParents::Known(parents),
            None => EventParents::UnknownEvent,
        }
    }

    #[must_use]
    pub fn quarantined(&self) -> &BTreeMap<Id, String> {
        &self.quarantined
    }

    pub fn insert(mut self, request: CausalEventInsertion<Id>) -> CausalInsertion<Id> {
        let CausalEventInsertion { id, parents } = request;
        let parents = Self::normalize_parents(parents);
        if let Some(existing) = self.parents.get_mut(&id) {
            if existing == &parents {
                return CausalInsertion {
                    graph: self,
                    status: CausalInsertStatus::Duplicate,
                };
            }
            let replaced = parents < *existing;
            if replaced {
                existing.clone_from(&parents);
            }
            self.quarantine_roots = Self::merge_quarantine_reason(
                self.quarantine_roots,
                id,
                "Conflicting causal parent sets for the same event id".to_owned(),
            );
            if replaced {
                self.cyclic = self.all_cyclic_ids();
            }
            self = self.recompute_quarantine();
            return CausalInsertion {
                graph: self,
                status: CausalInsertStatus::Conflict,
            };
        }
        let missing_parents = parents
            .iter()
            .filter(|parent| !self.parents.contains_key(*parent))
            .cloned()
            .collect::<Vec<_>>();
        self.parents.insert(id.clone(), parents.clone());
        self.cyclic.extend(self.cycle_members(&id));
        self = self.recompute_quarantine();
        let status = if let Some(reason) = self.quarantined.get(&id) {
            CausalInsertStatus::Quarantined {
                reason: reason.clone(),
            }
        } else if self.ancestor_ids_present(&parents) {
            CausalInsertStatus::Applied
        } else {
            CausalInsertStatus::Pending { missing_parents }
        };
        CausalInsertion {
            graph: self,
            status,
        }
    }

    #[must_use]
    pub fn quarantine(mut self, request: CausalQuarantine<Id>) -> Self {
        let CausalQuarantine { id, reason } = request;
        self.quarantine_roots = Self::merge_quarantine_reason(self.quarantine_roots, id, reason);
        self.recompute_quarantine()
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
                    self.parents.get(*id).is_some_and(|parents| {
                        parents
                            .iter()
                            .all(|parent| ordered.contains(parent) || !remaining.contains(parent))
                    })
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

    fn normalize_parents(mut parents: Vec<Id>) -> Vec<Id> {
        parents.sort();
        parents.dedup();
        parents
    }

    fn merge_quarantine_reason(
        mut reasons: BTreeMap<Id, String>,
        id: Id,
        reason: String,
    ) -> BTreeMap<Id, String> {
        reasons
            .entry(id)
            .and_modify(|existing| {
                if reason < *existing {
                    existing.clone_from(&reason);
                }
            })
            .or_insert(reason);
        reasons
    }

    fn recompute_quarantine(mut self) -> Self {
        self.quarantined.clone_from(&self.quarantine_roots);
        for id in &self.cyclic {
            self.quarantined = Self::merge_quarantine_reason(
                self.quarantined,
                id.clone(),
                "Causal graph contains a cycle".to_owned(),
            );
        }
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
                return self;
            }
            for id in rejected_descendants {
                self.quarantined = Self::merge_quarantine_reason(
                    self.quarantined,
                    id,
                    "Ancestor event was rejected".to_owned(),
                );
            }
        }
    }

    /// A newly inserted parent set can only introduce cycles through that
    /// event. Intersect its ancestors and descendants to find the complete
    /// strongly connected component in one linear graph scan.
    fn cycle_members(&self, origin: &Id) -> BTreeSet<Id> {
        let mut ancestors = BTreeSet::new();
        let mut stack = self.parents.get(origin).cloned().unwrap_or_default();
        while let Some(id) = stack.pop() {
            if !ancestors.insert(id.clone()) {
                continue;
            }
            if let Some(parents) = self.parents.get(&id) {
                stack.extend(parents.iter().cloned());
            }
        }
        if !ancestors.contains(origin) {
            return BTreeSet::new();
        }

        let mut reverse = BTreeMap::<Id, Vec<Id>>::new();
        for (id, parents) in &self.parents {
            for parent in parents {
                reverse.entry(parent.clone()).or_default().push(id.clone());
            }
        }
        let mut descendants = BTreeSet::new();
        let mut stack = vec![origin.clone()];
        while let Some(id) = stack.pop() {
            if !descendants.insert(id.clone()) {
                continue;
            }
            if let Some(children) = reverse.get(&id) {
                stack.extend(children.iter().cloned());
            }
        }
        ancestors.intersection(&descendants).cloned().collect()
    }

    fn all_cyclic_ids(&self) -> BTreeSet<Id> {
        self.parents
            .keys()
            .flat_map(|id| self.cycle_members(id))
            .collect()
    }
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;

    fn id(value: &str) -> String {
        value.to_owned()
    }

    #[test]
    fn event_count_has_typed_empty_and_single_event_states() {
        let mut graph = CausalGraph::new();
        assert_eq!(graph.len(), CausalGraphEventCount::EMPTY);

        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("root"),
                parents: Vec::new(),
            });
            graph = inserted.graph;
            inserted.status
        };

        assert_eq!(graph.len(), CausalGraphEventCount::SINGLE_EVENT);
    }

    #[test]
    fn event_count_round_trips_dynamic_values_above_one() {
        let mut graph = CausalGraph::new();
        for event_id in ["first", "second", "third"] {
            {
                let inserted = graph.insert(CausalEventInsertion {
                    id: id(event_id),
                    parents: Vec::new(),
                });
                graph = inserted.graph;
                inserted.status
            };
        }
        let count = CausalGraphEventCount::from(3);

        assert_eq!(graph.len(), count);
        assert_eq!(usize::from(count), 3);
    }

    #[test]
    fn pending_child_becomes_applicable_when_parent_arrives() -> anyhow::Result<()> {
        let mut graph = CausalGraph::new();
        assert_eq!(
            {
                let inserted = graph.insert(CausalEventInsertion {
                    id: id("child"),
                    parents: vec![id("root")],
                });
                graph = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Pending {
                missing_parents: vec![id("root")]
            }
        );
        assert_eq!(graph.pending_ids(), vec![&id("child")]);

        assert_eq!(
            {
                let inserted = graph.insert(CausalEventInsertion {
                    id: id("root"),
                    parents: Vec::new(),
                });
                graph = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Applied
        );
        assert!(graph.pending_ids().is_empty());
        assert_eq!(graph.topological_order()?, vec![id("root"), id("child")]);
        Ok(())
    }

    #[test]
    fn descendant_stays_pending_until_transitive_ancestor_arrives() -> anyhow::Result<()> {
        let mut graph = CausalGraph::new();
        assert!(matches!(
            {
                let inserted = graph.insert(CausalEventInsertion {
                    id: id("parent"),
                    parents: vec![id("root")],
                });
                graph = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Pending { .. }
        ));
        assert_eq!(
            {
                let inserted = graph.insert(CausalEventInsertion {
                    id: id("child"),
                    parents: vec![id("parent")],
                });
                graph = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Pending {
                missing_parents: Vec::new()
            }
        );
        assert_eq!(graph.pending_ids(), vec![&id("child"), &id("parent")]);

        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("root"),
                parents: Vec::new(),
            });
            graph = inserted.graph;
            inserted.status
        };
        assert!(graph.pending_ids().is_empty());
        Ok(())
    }

    #[test]
    fn direct_insertion_quarantines_conflicting_parent_sets_deterministically() -> anyhow::Result<()>
    {
        let mut left = CausalGraph::new();
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("a"),
                parents: Vec::new(),
            });
            left = inserted.graph;
            inserted.status
        };
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("b"),
                parents: Vec::new(),
            });
            left = inserted.graph;
            inserted.status
        };
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("same"),
                parents: vec![id("a")],
            });
            left = inserted.graph;
            inserted.status
        };
        assert_eq!(
            {
                let inserted = left.insert(CausalEventInsertion {
                    id: id("same"),
                    parents: vec![id("b")],
                });
                left = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Conflict
        );

        let mut right = CausalGraph::new();
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("a"),
                parents: Vec::new(),
            });
            right = inserted.graph;
            inserted.status
        };
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("b"),
                parents: Vec::new(),
            });
            right = inserted.graph;
            inserted.status
        };
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("same"),
                parents: vec![id("b")],
            });
            right = inserted.graph;
            inserted.status
        };
        assert_eq!(
            {
                let inserted = right.insert(CausalEventInsertion {
                    id: id("same"),
                    parents: vec![id("a")],
                });
                right = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Conflict
        );

        assert_eq!(left, right);
        assert!(left.quarantined().contains_key("same"));
        assert_eq!(
            left.parents(&id("same")),
            EventParents::Known([id("a")].as_slice())
        );
        Ok(())
    }

    #[test]
    fn conflicting_parent_replacement_recomputes_cycles_deterministically() -> anyhow::Result<()> {
        let mut left = CausalGraph::new();
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("a"),
                parents: vec![id("same")],
            });
            left = inserted.graph;
            inserted.status
        };
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("b"),
                parents: Vec::new(),
            });
            left = inserted.graph;
            inserted.status
        };
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("same"),
                parents: vec![id("b")],
            });
            left = inserted.graph;
            inserted.status
        };
        assert_eq!(
            {
                let inserted = left.insert(CausalEventInsertion {
                    id: id("same"),
                    parents: vec![id("a")],
                });
                left = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Conflict
        );

        let mut right = CausalGraph::new();
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("a"),
                parents: vec![id("same")],
            });
            right = inserted.graph;
            inserted.status
        };
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("b"),
                parents: Vec::new(),
            });
            right = inserted.graph;
            inserted.status
        };
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("same"),
                parents: vec![id("a")],
            });
            right = inserted.graph;
            inserted.status
        };
        assert_eq!(
            {
                let inserted = right.insert(CausalEventInsertion {
                    id: id("same"),
                    parents: vec![id("b")],
                });
                right = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Conflict
        );

        assert_eq!(left, right);
        assert_eq!(
            left.quarantined(),
            &BTreeMap::from([
                (id("a"), id("Causal graph contains a cycle")),
                (id("same"), id("Causal graph contains a cycle")),
            ])
        );
        Ok(())
    }

    #[test]
    fn parent_sets_are_normalized_before_duplicate_detection() -> anyhow::Result<()> {
        let mut graph = CausalGraph::new();
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("a"),
                parents: Vec::new(),
            });
            graph = inserted.graph;
            inserted.status
        };
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("b"),
                parents: Vec::new(),
            });
            graph = inserted.graph;
            inserted.status
        };
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("same"),
                parents: vec![id("b"), id("a"), id("b")],
            });
            graph = inserted.graph;
            inserted.status
        };

        assert_eq!(
            {
                let inserted = graph.insert(CausalEventInsertion {
                    id: id("same"),
                    parents: vec![id("a"), id("b")],
                });
                graph = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Duplicate
        );
        assert_eq!(
            graph.parents(&id("same")),
            EventParents::Known([id("a"), id("b")].as_slice())
        );
        assert!(!graph.quarantined().contains_key("same"));
        Ok(())
    }

    #[test]
    fn concurrent_branches_and_join_have_deterministic_heads() -> anyhow::Result<()> {
        let mut graph = CausalGraph::new();
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("root"),
                parents: Vec::new(),
            });
            graph = inserted.graph;
            inserted.status
        };
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("left"),
                parents: vec![id("root")],
            });
            graph = inserted.graph;
            inserted.status
        };
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("right"),
                parents: vec![id("root")],
            });
            graph = inserted.graph;
            inserted.status
        };

        assert!(graph.are_concurrent(&id("left"), &id("right")));
        assert_eq!(graph.heads(), vec![id("left"), id("right")]);

        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("join"),
                parents: vec![id("left"), id("right")],
            });
            graph = inserted.graph;
            inserted.status
        };
        assert_eq!(graph.heads(), vec![id("join")]);
        Ok(())
    }

    #[test]
    fn quarantined_events_are_excluded_from_projection_order() -> anyhow::Result<()> {
        let mut graph = CausalGraph::new();
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("root"),
                parents: Vec::new(),
            });
            graph = inserted.graph;
            inserted.status
        };
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("rejected"),
                parents: vec![id("root")],
            });
            graph = inserted.graph;
            inserted.status
        };
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("descendant"),
                parents: vec![id("rejected")],
            });
            graph = inserted.graph;
            inserted.status
        };
        graph = graph.quarantine(CausalQuarantine {
            id: id("rejected"),
            reason: "policy rejected".to_owned(),
        });
        graph = graph.quarantine(CausalQuarantine {
            id: id("descendant"),
            reason: "ancestor rejected".to_owned(),
        });

        assert_eq!(graph.topological_order()?, vec![id("root")]);
        assert_eq!(graph.heads(), vec![id("root")]);
        Ok(())
    }

    #[test]
    fn quarantine_propagates_through_indexed_and_future_descendants() -> anyhow::Result<()> {
        let mut graph = CausalGraph::new();
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("root"),
                parents: Vec::new(),
            });
            graph = inserted.graph;
            inserted.status
        };
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("rejected"),
                parents: vec![id("root")],
            });
            graph = inserted.graph;
            inserted.status
        };
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("descendant"),
                parents: vec![id("rejected")],
            });
            graph = inserted.graph;
            inserted.status
        };

        graph = graph.quarantine(CausalQuarantine {
            id: id("rejected"),
            reason: id("invalid signature"),
        });
        assert!(graph.quarantined().contains_key("descendant"));
        assert_eq!(graph.topological_order()?, vec![id("root")]);
        assert_eq!(
            {
                let inserted = graph.insert(CausalEventInsertion {
                    id: id("future"),
                    parents: vec![id("descendant")],
                });
                graph = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Quarantined {
                reason: id("Ancestor event was rejected")
            }
        );
        assert!(graph.quarantined().contains_key("future"));
        assert_eq!(graph.topological_order()?, vec![id("root")]);
        Ok(())
    }

    #[test]
    fn cycles_are_quarantined_and_excluded_from_applicability() -> anyhow::Result<()> {
        let mut graph = CausalGraph::new();
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("left"),
                parents: vec![id("right")],
            });
            graph = inserted.graph;
            inserted.status
        };
        assert_eq!(
            {
                let inserted = graph.insert(CausalEventInsertion {
                    id: id("right"),
                    parents: vec![id("left")],
                });
                graph = inserted.graph;
                inserted.status
            },
            CausalInsertStatus::Quarantined {
                reason: id("Causal graph contains a cycle")
            }
        );
        {
            let inserted = graph.insert(CausalEventInsertion {
                id: id("unrelated"),
                parents: Vec::new(),
            });
            graph = inserted.graph;
            inserted.status
        };

        assert!(!graph.is_ancestor(&id("unrelated"), &id("left")));
        assert!(graph.is_ancestor(&id("right"), &id("left")));
        assert!(!graph.are_concurrent(&id("left"), &id("right")));
        assert_eq!(graph.applicable_ids(), vec![&id("unrelated")]);
        assert_eq!(graph.topological_order()?, vec![id("unrelated")]);
        assert_eq!(
            graph.quarantined().keys().cloned().collect::<Vec<_>>(),
            vec![id("left"), id("right")]
        );
        Ok(())
    }
}
