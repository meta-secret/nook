use clap::{ArgMatches, Args, Command, FromArgMatches};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum SandboxExecutable {
    Embedded,
    Override(PathBuf),
}
impl FromArgMatches for SandboxExecutable {
    fn from_arg_matches(matches: &ArgMatches) -> Result<Self, clap::Error> {
        Ok(
            match matches.get_one::<PathBuf>("codex_linux_sandbox_exe") {
                Some(path) => Self::Override(path.clone()),
                None => Self::Embedded,
            },
        )
    }
    fn update_from_arg_matches(&mut self, matches: &ArgMatches) -> Result<(), clap::Error> {
        if matches.contains_id("codex_linux_sandbox_exe") {
            *self = Self::from_arg_matches(matches)?;
        }
        Ok(())
    }
}
impl Args for SandboxExecutable {
    fn augment_args(command: Command) -> Command {
        command.arg(
            clap::Arg::new("codex_linux_sandbox_exe")
                .long("codex-linux-sandbox-exe")
                .env("HIVE_CODEX_LINUX_SANDBOX_EXE")
                .value_name("CODEX_LINUX_SANDBOX_EXE")
                .value_parser(clap::value_parser!(PathBuf))
                .required(false)
                .action(clap::ArgAction::Set),
        )
    }
    fn augment_args_for_update(command: Command) -> Command {
        Self::augment_args(command)
    }
}
