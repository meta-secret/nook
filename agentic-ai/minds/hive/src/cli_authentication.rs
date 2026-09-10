use clap::{ArgMatches, Args, Command, FromArgMatches};

#[derive(Debug, Clone)]
pub(super) enum Neo4jAuthentication {
    Unconfigured,
    Password(String),
}
impl Neo4jAuthentication {
    pub(super) fn require_password(&self, operation: &str) -> hive::HiveResult<&str> {
        match self {
            Self::Password(password) => Ok(password),
            Self::Unconfigured => Err(hive::HiveError::message(operation)),
        }
    }
}
impl FromArgMatches for Neo4jAuthentication {
    fn from_arg_matches(matches: &ArgMatches) -> Result<Self, clap::Error> {
        Ok(match matches.get_one::<String>("neo4j_password") {
            Some(password) => Self::Password(password.clone()),
            None => Self::Unconfigured,
        })
    }
    fn update_from_arg_matches(&mut self, matches: &ArgMatches) -> Result<(), clap::Error> {
        if matches.contains_id("neo4j_password") {
            *self = Self::from_arg_matches(matches)?;
        }
        Ok(())
    }
}
impl Args for Neo4jAuthentication {
    fn augment_args(command: Command) -> Command {
        command.arg(
            clap::Arg::new("neo4j_password")
                .long("neo4j-password")
                .env("NEO4J_PASSWORD")
                .hide_env_values(true)
                .value_name("NEO4J_PASSWORD")
                .value_parser(clap::value_parser!(String))
                .required(false)
                .action(clap::ArgAction::Set),
        )
    }
    fn augment_args_for_update(command: Command) -> Command {
        Self::augment_args(command)
    }
}
