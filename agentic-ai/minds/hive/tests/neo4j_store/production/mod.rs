mod dependencies;
mod lease;
mod lifecycle;
mod recovery;

use std::env;

use hive::model::AgentId;
use hive::{Neo4jTaskStore, TaskStore};
use neo4rs::{ConfigBuilder, Graph, query};
use uuid::Uuid;

pub(super) struct StoreFixture<'a> {
    pub(super) store: &'a Neo4jTaskStore,
    pub(super) graph: &'a Graph,
    pub(super) agent_a: &'a AgentId,
    pub(super) agent_b: &'a AgentId,
    pub(super) agent_c: &'a AgentId,
    pub(super) suffix: &'a str,
}

pub(super) async fn run() -> anyhow::Result<()> {
    let Ok(uri) = env::var("HIVE_NEO4J_TEST_URI") else {
        return Ok(());
    };
    let username = env::var("HIVE_NEO4J_TEST_USERNAME").unwrap_or_else(|_| "neo4j".to_owned());
    let password = env::var("HIVE_NEO4J_TEST_PASSWORD")?;
    let store = Neo4jTaskStore::connect(&uri, &username, &password).await?;
    store.migrate().await?;
    let graph = Graph::connect(
        ConfigBuilder::default()
            .uri(&uri)
            .user(&username)
            .password(&password)
            .db("neo4j")
            .build()?,
    )
    .await?;
    graph.run(query("MATCH (node) DETACH DELETE node")).await?;

    let suffix = Uuid::new_v4().simple().to_string();
    let agent_a = AgentId::try_from(format!("agent-a-{suffix}"))?;
    let agent_b = AgentId::try_from(format!("agent-b-{suffix}"))?;
    let agent_c = AgentId::try_from(format!("agent-c-{suffix}"))?;
    for agent in [&agent_a, &agent_b, &agent_c] {
        store.register_agent(agent, agent.as_str()).await?;
    }
    let fixture = StoreFixture {
        store: &store,
        graph: &graph,
        agent_a: &agent_a,
        agent_b: &agent_b,
        agent_c: &agent_c,
        suffix: &suffix,
    };

    dependencies::verify(&fixture).await?;
    lifecycle::verify(&fixture).await?;
    recovery::verify(&fixture).await?;
    lease::verify(&fixture).await?;
    crate::cancellation::CancellationScenario {
        store: &store,
        graph: &graph,
        agent_a: &agent_a,
        agent_b: &agent_b,
        suffix: &suffix,
    }
    .exercise()
    .await?;
    crate::schema::verify_migrations(&store, &graph).await
}
