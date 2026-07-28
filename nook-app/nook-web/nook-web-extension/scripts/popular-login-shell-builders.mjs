function field(partial) {
  return { type: 'text', ...partial }
}

function shell(quirks, steps) {
  return { quirks, steps }
}

function emailPassword(quirks = []) {
  return shell(quirks, [
    {
      fields: [
        field({
          name: 'email',
          type: 'email',
          autocomplete: 'username',
          placeholder: 'Email',
          'aria-label': 'Email',
        }),
        field({
          name: 'password',
          type: 'password',
          autocomplete: 'current-password',
          placeholder: 'Password',
          'aria-label': 'Password',
        }),
      ],
      submit: { type: 'submit', label: 'Sign in' },
    },
  ])
}

function usernamePassword(quirks = []) {
  return shell(quirks, [
    {
      fields: [
        field({
          name: 'username',
          type: 'text',
          autocomplete: 'username',
          placeholder: 'Username',
          'aria-label': 'Username',
        }),
        field({
          name: 'password',
          type: 'password',
          autocomplete: 'current-password',
          placeholder: 'Password',
          'aria-label': 'Password',
        }),
      ],
      submit: { type: 'submit', label: 'Sign in' },
    },
  ])
}

function emailFirst() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'email',
            type: 'email',
            autocomplete: 'username',
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
        ],
        submit: { type: 'submit', label: 'Continue' },
      },
      {
        fields: [
          field({
            name: 'email',
            type: 'email',
            autocomplete: 'username',
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function usernameFirst() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'username',
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Username',
            'aria-label': 'Username',
          }),
        ],
        submit: { type: 'submit', label: 'Next' },
      },
      {
        fields: [
          field({
            name: 'username',
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Username',
            'aria-label': 'Username',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function telPassword() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'phone',
            type: 'tel',
            autocomplete: 'tel',
            placeholder: 'Phone number',
            'aria-label': 'Phone number',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function phoneFirst() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'phone',
            type: 'tel',
            autocomplete: 'tel',
            placeholder: 'Mobile number',
            'aria-label': 'Mobile number',
          }),
        ],
        submit: { type: 'submit', label: 'Continue' },
      },
      {
        fields: [
          field({
            name: 'phone',
            type: 'tel',
            autocomplete: 'tel',
            placeholder: 'Mobile number',
            'aria-label': 'Mobile number',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function memberIdPassword() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'memberId',
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Member ID',
            'aria-label': 'Member ID',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function employeeIdPassword() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'employeeId',
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Employee ID',
            'aria-label': 'Employee ID',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function passwordThenOtp() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'email',
            type: 'email',
            autocomplete: 'username',
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
      {
        fields: [
          field({
            name: 'otp',
            type: 'text',
            autocomplete: 'one-time-code',
            placeholder: 'Verification code',
            'aria-label': 'Verification code',
          }),
        ],
        submit: { type: 'submit', label: 'Verify' },
      },
    ],
  )
}

function dualIdentityPassword() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'email',
            type: 'email',
            autocomplete: 'username',
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
          field({
            name: 'phone',
            type: 'tel',
            autocomplete: 'tel',
            placeholder: 'Phone',
            'aria-label': 'Phone',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function accountNumberPassword() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'accountNumber',
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Account number',
            'aria-label': 'Account number',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function pinLogin() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'userid',
            type: 'text',
            autocomplete: 'username',
            placeholder: 'User ID',
            'aria-label': 'User ID',
          }),
          field({
            name: 'pin',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'PIN',
            'aria-label': 'PIN',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  )
}

function enterpriseSsoEmail() {
  return shell(
    [],
    [
      {
        fields: [
          field({
            name: 'email',
            type: 'email',
            autocomplete: 'username',
            placeholder: 'Work email',
            'aria-label': 'Work email',
          }),
        ],
        submit: { type: 'submit', label: 'Continue with SSO' },
      },
    ],
  )
}

function emailPasswordAriaHidden() {
  return emailPassword(['aria-hidden-ancestor'])
}

export const NEW_TEMPLATES = {
  'username-first': usernameFirst(),
  'tel-password': telPassword(),
  'phone-first': phoneFirst(),
  'member-id-password': memberIdPassword(),
  'employee-id-password': employeeIdPassword(),
  'password-then-otp': passwordThenOtp(),
  'dual-identity-password': dualIdentityPassword(),
  'account-number-password': accountNumberPassword(),
  'pin-login': pinLogin(),
  'enterprise-sso-email': enterpriseSsoEmail(),
  'email-password-aria-hidden': emailPasswordAriaHidden(),
}

export { emailFirst, emailPassword, usernamePassword }
