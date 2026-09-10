//! Owned causal graph union and its algebraic behavior.
use super::*;
impl<Id: Clone + Ord> CausalGraph<Id> {
    #[must_use]
    pub fn union(self, other: &Self) -> Self {
        let mut merged = self;
        for (id, parents) in &other.parents {
            let parents = Self::normalize_parents(parents.clone());
            match merged.parents.get_mut(id) {
                Some(existing) if existing != &parents => {
                    if parents < *existing {
                        existing.clone_from(&parents);
                    }
                    merged.quarantine_roots = Self::merge_quarantine_reason(
                        merged.quarantine_roots,
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
        for (id, reason) in &other.quarantine_roots {
            merged.quarantine_roots =
                Self::merge_quarantine_reason(merged.quarantine_roots, id.clone(), reason.clone());
        }
        merged.cyclic = merged.all_cyclic_ids();
        merged.recompute_quarantine()
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
    fn union_is_commutative_associative_and_idempotent() -> anyhow::Result<()> {
        let mut left = CausalGraph::new();
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("root"),
                parents: Vec::new(),
            });
            left = inserted.graph;
            inserted.status
        };
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("left"),
                parents: vec![id("root")],
            });
            left = inserted.graph;
            inserted.status
        };

        let mut right = CausalGraph::new();
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("root"),
                parents: Vec::new(),
            });
            right = inserted.graph;
            inserted.status
        };
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("right"),
                parents: vec![id("root")],
            });
            right = inserted.graph;
            inserted.status
        };

        let mut third = CausalGraph::new();
        {
            let inserted = third.insert(CausalEventInsertion {
                id: id("join"),
                parents: vec![id("left"), id("right")],
            });
            third = inserted.graph;
            inserted.status
        };

        assert_eq!(left.clone().union(&right), right.clone().union(&left));
        assert_eq!(
            left.clone().union(&right).union(&third),
            left.clone().union(&right.clone().union(&third))
        );
        assert_eq!(left.clone().union(&left), left);
        Ok(())
    }
    #[test]
    fn union_quarantines_conflicting_parent_sets_commutatively() -> anyhow::Result<()> {
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
                id: id("same"),
                parents: vec![id("a")],
            });
            left = inserted.graph;
            inserted.status
        };

        let mut right = CausalGraph::new();
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

        let left_right = left.clone().union(&right);
        let right_left = right.clone().union(&left);
        assert_eq!(left_right, right_left);
        assert!(left_right.quarantined().contains_key("same"));
        assert_eq!(
            left_right.parents(&id("same")),
            EventParents::Known([id("a")].as_slice())
        );
        Ok(())
    }
    #[test]
    fn union_preserves_the_deterministic_minimum_quarantine_reason() -> anyhow::Result<()> {
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
        left = left.quarantine(CausalQuarantine {
            id: id("same"),
            reason: id("A-policy"),
        });

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

        let left_right = left.clone().union(&right);
        assert_eq!(left_right, right.clone().union(&left));
        assert_eq!(
            left_right.quarantined().get("same").map(String::as_str),
            Some("A-policy")
        );
        Ok(())
    }
    #[test]
    fn union_recomputes_derived_quarantine_associatively() -> anyhow::Result<()> {
        let mut left = CausalGraph::new();
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("0"),
                parents: Vec::new(),
            });
            left = inserted.graph;
            inserted.status
        };
        {
            let inserted = left.insert(CausalEventInsertion {
                id: id("1"),
                parents: Vec::new(),
            });
            left = inserted.graph;
            inserted.status
        };

        let mut middle = CausalGraph::new();
        {
            let inserted = middle.insert(CausalEventInsertion {
                id: id("0"),
                parents: Vec::new(),
            });
            middle = inserted.graph;
            inserted.status
        };
        middle = middle.quarantine(CausalQuarantine {
            id: id("0"),
            reason: id("policy rejected"),
        });

        let mut right = CausalGraph::new();
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("0"),
                parents: Vec::new(),
            });
            right = inserted.graph;
            inserted.status
        };
        {
            let inserted = right.insert(CausalEventInsertion {
                id: id("1"),
                parents: vec![id("0")],
            });
            right = inserted.graph;
            inserted.status
        };

        let left_associative = left.clone().union(&middle).union(&right);
        let right_associative = left.clone().union(&middle.clone().union(&right));
        assert_eq!(left_associative, right_associative);
        assert_eq!(
            left_associative.quarantined().get("1").map(String::as_str),
            Some("Conflicting causal parent sets for the same event id")
        );
        Ok(())
    }
}
