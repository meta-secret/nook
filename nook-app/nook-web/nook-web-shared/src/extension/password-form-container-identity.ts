enum AuthenticationContainerIdentityWord {
  In = "in",
  Login = "login",
  Reset = "reset",
  Sign = "sign",
  Signin = "signin",
  Signup = "signup",
  Up = "up",
}

function identityWordsContainAuthentication(words: readonly string[]): boolean {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    switch (word) {
      case AuthenticationContainerIdentityWord.Login:
      case AuthenticationContainerIdentityWord.Reset:
      case AuthenticationContainerIdentityWord.Signin:
      case AuthenticationContainerIdentityWord.Signup:
        return true;
      case AuthenticationContainerIdentityWord.Sign:
        if (
          words[index + 1] === AuthenticationContainerIdentityWord.In ||
          words[index + 1] === AuthenticationContainerIdentityWord.Up
        )
          return true;
        break;
      case AuthenticationContainerIdentityWord.In:
      case AuthenticationContainerIdentityWord.Up:
        break;
    }
  }
  return false;
}

export function containerHasAuthenticationIdentity(
  container: Element,
): boolean {
  const identity = [
    container.id,
    ((value) => (value ? value : ""))(container.getAttribute("class")),
  ].join(" ");
  const words = identity
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  return identityWordsContainAuthentication(words);
}
