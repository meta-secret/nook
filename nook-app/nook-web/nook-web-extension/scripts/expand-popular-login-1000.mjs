#!/usr/bin/env node
/**
 * Expand popular_login_sites.json to exactly 1000 password-manager-relevant
 * destinations and remap site-shells.json onto unique shell templates.
 *
 * Does not hit live sites. Capture remains offline via capture-login-shell.mjs.
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const catalogPath = path.join(root, 'nook-core/data/popular_login_sites.json')
const fixturesRoot = path.join(
  root,
  'nook-web/nook-web-extension/e2e/mock-auth/fixtures',
)
const templatesDir = path.join(fixturesRoot, 'templates')
const siteShellsPath = path.join(fixturesRoot, 'site-shells.json')

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

/** Keep hand-tuned Tier-1 / family shells from existing templates when present. */
function loadExistingTemplates() {
  /** @type {Map<string, { id: string, quirks: string[], steps: unknown[] }>} */
  const map = new Map()
  for (const name of readdirSync(templatesDir).filter((n) =>
    n.endsWith('.json'),
  )) {
    const id = name.replace(/\.json$/u, '')
    const data = JSON.parse(readFileSync(path.join(templatesDir, name), 'utf8'))
    map.set(id, { id, quirks: data.quirks ?? [], steps: data.steps })
  }
  return map
}

const NEW_TEMPLATES = {
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

/** Extra curated destinations beyond the seeded top-100 catalog. */
const EXTRA = [
  // Telecom / carriers
  [
    'verizon',
    'Verizon',
    'verizon',
    'https://login.verizonwireless.com/',
    ['verizon.com', 'verizonwireless.com'],
    'tel-password',
  ],
  [
    'att',
    'AT&T',
    'att',
    'https://www.att.com/account/login/',
    ['att.com'],
    'tel-password',
  ],
  [
    'tmobile',
    'T-Mobile',
    'tmobile',
    'https://account.t-mobile.com/signin/v2/',
    ['t-mobile.com', 'account.t-mobile.com'],
    'tel-password',
  ],
  [
    'comcast',
    'Xfinity',
    'comcast',
    'https://login.xfinity.com/login',
    ['xfinity.com', 'comcast.net'],
    'email-password',
  ],
  [
    'spectrum',
    'Spectrum',
    'spectrum',
    'https://www.spectrum.net/login/',
    ['spectrum.net'],
    'username-password',
  ],
  [
    'cox',
    'Cox',
    'cox',
    'https://www.cox.com/residentiallogin/',
    ['cox.com'],
    'username-password',
  ],
  [
    'rogers',
    'Rogers',
    'rogers',
    'https://www.rogers.com/consumer/login',
    ['rogers.com'],
    'email-password',
  ],
  [
    'telus',
    'Telus',
    'telus',
    'https://www.telus.com/my-telus/login',
    ['telus.com'],
    'email-password',
  ],
  [
    'bell',
    'Bell',
    'bell',
    'https://www.bell.ca/MyBell/Login',
    ['bell.ca'],
    'email-password',
  ],
  [
    'vodafone',
    'Vodafone',
    'vodafone',
    'https://www.vodafone.com/login',
    ['vodafone.com'],
    'tel-password',
  ],
  [
    'orange',
    'Orange',
    'orange',
    'https://login.orange.com/',
    ['orange.com'],
    'tel-password',
  ],
  [
    'telefonica',
    'Telefónica',
    'telefonica',
    'https://www.telefonica.com/en/login/',
    ['telefonica.com'],
    'email-password',
  ],
  // Insurance / health
  [
    'geico',
    'GEICO',
    'geico',
    'https://ecams.geico.com/login',
    ['geico.com'],
    'username-password',
  ],
  [
    'progressive',
    'Progressive',
    'progressive',
    'https://auth.progressive.com/',
    ['progressive.com'],
    'username-password',
  ],
  [
    'statefarm',
    'State Farm',
    'statefarm',
    'https://www.statefarm.com/customer-login',
    ['statefarm.com'],
    'username-password',
  ],
  [
    'allstate',
    'Allstate',
    'allstate',
    'https://www.allstate.com/login',
    ['allstate.com'],
    'username-password',
  ],
  [
    'usaa',
    'USAA',
    'usaa',
    'https://www.usaa.com/my/logon',
    ['usaa.com'],
    'username-password',
  ],
  [
    'anthem',
    'Anthem',
    'anthem',
    'https://www.anthem.com/login/',
    ['anthem.com'],
    'member-id-password',
  ],
  [
    'aetna',
    'Aetna',
    'aetna',
    'https://www.aetna.com/individuals-families/login.html',
    ['aetna.com'],
    'member-id-password',
  ],
  [
    'cigna',
    'Cigna',
    'cigna',
    'https://my.cigna.com/',
    ['cigna.com', 'my.cigna.com'],
    'member-id-password',
  ],
  [
    'unitedhealthcare',
    'UnitedHealthcare',
    'uhc',
    'https://www.uhc.com/en/login',
    ['uhc.com', 'unitedhealthcare.com'],
    'member-id-password',
  ],
  [
    'kaiser',
    'Kaiser Permanente',
    'kaiser',
    'https://healthy.kaiserpermanente.org/sign-on',
    ['kaiserpermanente.org'],
    'member-id-password',
  ],
  [
    'cvs',
    'CVS',
    'cvs',
    'https://www.cvs.com/account/login/',
    ['cvs.com'],
    'email-password',
  ],
  [
    'walgreens',
    'Walgreens',
    'walgreens',
    'https://www.walgreens.com/login.jsp',
    ['walgreens.com'],
    'email-password',
  ],
  [
    'optum',
    'Optum',
    'optum',
    'https://www.optum.com/login.html',
    ['optum.com'],
    'member-id-password',
  ],
  // More banks / fintech
  [
    'tdbank',
    'TD Bank',
    'td',
    'https://onlinebanking.tdbank.com/',
    ['tdbank.com'],
    'username-password',
  ],
  [
    'pnc',
    'PNC',
    'pnc',
    'https://www.pnc.com/en/personal-banking/banking/online-and-mobile-banking/sign-on.html',
    ['pnc.com'],
    'username-password',
  ],
  [
    'truist',
    'Truist',
    'truist',
    'https://banking.truist.com/login',
    ['truist.com'],
    'username-password',
  ],
  [
    'regions',
    'Regions',
    'regions',
    'https://www.regions.com/digitalbanking/login',
    ['regions.com'],
    'username-password',
  ],
  [
    'ally',
    'Ally',
    'ally',
    'https://www.ally.com/bank/online-banking/',
    ['ally.com'],
    'username-password',
  ],
  [
    'sofi',
    'SoFi',
    'sofi',
    'https://www.sofi.com/login/',
    ['sofi.com'],
    'email-password',
  ],
  [
    'chime',
    'Chime',
    'chime',
    'https://app.chime.com/login',
    ['chime.com'],
    'email-password',
  ],
  [
    'revolut',
    'Revolut',
    'revolut',
    'https://app.revolut.com/start',
    ['revolut.com'],
    'phone-first',
  ],
  [
    'wise',
    'Wise',
    'wise',
    'https://wise.com/login',
    ['wise.com'],
    'email-first',
  ],
  [
    'venmo',
    'Venmo',
    'venmo',
    'https://venmo.com/account/sign-in',
    ['venmo.com'],
    'email-password',
  ],
  [
    'squareup',
    'Square',
    'square',
    'https://squareup.com/login',
    ['squareup.com', 'square.com'],
    'email-first',
  ],
  [
    'intuit',
    'Intuit',
    'intuit',
    'https://accounts.intuit.com/',
    ['intuit.com'],
    'email-first',
  ],
  [
    'turbotax',
    'TurboTax',
    'intuit',
    'https://turbotax.intuit.com/personal-taxes/sign-in/',
    ['turbotax.intuit.com'],
    'email-first',
  ],
  [
    'quickbooks',
    'QuickBooks',
    'intuit',
    'https://accounts.intuit.com/app/sign-in',
    ['quickbooks.intuit.com'],
    'email-first',
  ],
  [
    'creditkarma',
    'Credit Karma',
    'creditkarma',
    'https://www.creditkarma.com/auth/logon',
    ['creditkarma.com'],
    'email-password',
  ],
  [
    'nerdwallet',
    'NerdWallet',
    'nerdwallet',
    'https://www.nerdwallet.com/login',
    ['nerdwallet.com'],
    'email-password',
  ],
  [
    'experian',
    'Experian',
    'experian',
    'https://www.experian.com/login',
    ['experian.com'],
    'email-password',
  ],
  [
    'equifax',
    'Equifax',
    'equifax',
    'https://www.equifax.com/personal/login/',
    ['equifax.com'],
    'email-password',
  ],
  [
    'transunion',
    'TransUnion',
    'transunion',
    'https://membership.tui.transunion.com/tucm/login.page',
    ['transunion.com'],
    'email-password',
  ],
  // Shopping / retail
  [
    'macys',
    "Macy's",
    'macys',
    'https://www.macys.com/account/signin',
    ['macys.com'],
    'email-password',
  ],
  [
    'nordstrom',
    'Nordstrom',
    'nordstrom',
    'https://www.nordstrom.com/signin',
    ['nordstrom.com'],
    'email-password',
  ],
  [
    'nike',
    'Nike',
    'nike',
    'https://www.nike.com/login',
    ['nike.com'],
    'email-first',
  ],
  [
    'adidas',
    'adidas',
    'adidas',
    'https://www.adidas.com/us/account-login',
    ['adidas.com'],
    'email-password',
  ],
  [
    'ikea',
    'IKEA',
    'ikea',
    'https://www.ikea.com/us/en/profile/login/',
    ['ikea.com'],
    'email-password',
  ],
  [
    'wayfair',
    'Wayfair',
    'wayfair',
    'https://www.wayfair.com/v/account/authentication/login',
    ['wayfair.com'],
    'email-password',
  ],
  [
    'chewy',
    'Chewy',
    'chewy',
    'https://www.chewy.com/app/login',
    ['chewy.com'],
    'email-password',
  ],
  [
    'instacart',
    'Instacart',
    'instacart',
    'https://www.instacart.com/accounts/login',
    ['instacart.com'],
    'email-first',
  ],
  [
    'sephora',
    'Sephora',
    'sephora',
    'https://www.sephora.com/login',
    ['sephora.com'],
    'email-password',
  ],
  [
    'ulta',
    'Ulta',
    'ulta',
    'https://www.ulta.com/signin',
    ['ulta.com'],
    'email-password',
  ],
  [
    'zara',
    'Zara',
    'zara',
    'https://www.zara.com/us/en/logon',
    ['zara.com'],
    'email-password',
  ],
  [
    'hm',
    'H&M',
    'hm',
    'https://www2.hm.com/en_us/login',
    ['hm.com'],
    'email-password',
  ],
  [
    'uniqlo',
    'Uniqlo',
    'uniqlo',
    'https://www.uniqlo.com/us/en/login',
    ['uniqlo.com'],
    'email-password',
  ],
  [
    'shein',
    'SHEIN',
    'shein',
    'https://www.shein.com/user/login',
    ['shein.com'],
    'email-password',
  ],
  [
    'aliexpress',
    'AliExpress',
    'aliexpress',
    'https://login.aliexpress.com/',
    ['aliexpress.com'],
    'email-password',
  ],
  [
    'alibaba',
    'Alibaba',
    'alibaba',
    'https://login.alibaba.com/',
    ['alibaba.com'],
    'email-password',
  ],
  [
    'temu',
    'Temu',
    'temu',
    'https://www.temu.com/login.html',
    ['temu.com'],
    'email-password',
  ],
  [
    'shopify-store',
    'Shopify Store Login',
    'shopify',
    'https://accounts.shopify.com/store-login',
    ['shopify.com'],
    'email-first',
  ],
  // Travel more
  [
    'aa',
    'American Airlines',
    'aa',
    'https://www.aa.com/loyalty/login',
    ['aa.com'],
    'username-password',
  ],
  [
    'jetblue',
    'JetBlue',
    'jetblue',
    'https://trueblue.jetblue.com/web/trueblue/login',
    ['jetblue.com'],
    'username-password',
  ],
  [
    'spirit',
    'Spirit',
    'spirit',
    'https://www.spirit.com/account/login',
    ['spirit.com'],
    'email-password',
  ],
  [
    'alaskaair',
    'Alaska Airlines',
    'alaska',
    'https://www.alaskaair.com/account/login',
    ['alaskaair.com'],
    'username-password',
  ],
  [
    'ryanair',
    'Ryanair',
    'ryanair',
    'https://www.ryanair.com/gb/en/account/login',
    ['ryanair.com'],
    'email-password',
  ],
  [
    'easyjet',
    'easyJet',
    'easyjet',
    'https://www.easyjet.com/en/login',
    ['easyjet.com'],
    'email-password',
  ],
  [
    'britishairways',
    'British Airways',
    'ba',
    'https://www.britishairways.com/travel/loginr/public/en_us',
    ['britishairways.com'],
    'username-password',
  ],
  [
    'lufthansa',
    'Lufthansa',
    'lufthansa',
    'https://www.lufthansa.com/us/en/homepage',
    ['lufthansa.com'],
    'email-password',
  ],
  [
    'airbnb-host',
    'Airbnb Host',
    'airbnb',
    'https://www.airbnb.com/login',
    ['airbnb.com'],
    'email-password',
  ],
  [
    'vrbo',
    'Vrbo',
    'vrbo',
    'https://www.vrbo.com/auth/ui/login',
    ['vrbo.com'],
    'email-password',
  ],
  [
    'tripadvisor',
    'Tripadvisor',
    'tripadvisor',
    'https://www.tripadvisor.com/RegistrationController',
    ['tripadvisor.com'],
    'email-password',
  ],
  [
    'kayak',
    'KAYAK',
    'kayak',
    'https://www.kayak.com/login',
    ['kayak.com'],
    'email-password',
  ],
  [
    'skyscanner',
    'Skyscanner',
    'skyscanner',
    'https://www.skyscanner.com/login',
    ['skyscanner.com'],
    'email-password',
  ],
  [
    'hotelscom',
    'Hotels.com',
    'hotels',
    'https://www.hotels.com/login',
    ['hotels.com'],
    'email-password',
  ],
  [
    'hyatt',
    'Hyatt',
    'hyatt',
    'https://www.hyatt.com/en-US/explore-hotels/login',
    ['hyatt.com'],
    'email-password',
  ],
  [
    'ihg',
    'IHG',
    'ihg',
    'https://www.ihg.com/hotels/us/en/reservation/searchresult',
    ['ihg.com'],
    'member-id-password',
  ],
  // Streaming / media
  [
    'peacock',
    'Peacock',
    'peacock',
    'https://www.peacocktv.com/signin',
    ['peacocktv.com'],
    'email-password',
  ],
  [
    'appletv',
    'Apple TV',
    'apple',
    'https://tv.apple.com/login',
    ['tv.apple.com'],
    'apple',
  ],
  [
    'crunchyroll',
    'Crunchyroll',
    'crunchyroll',
    'https://sso.crunchyroll.com/login',
    ['crunchyroll.com'],
    'email-password',
  ],
  [
    'funimation',
    'Crunchyroll Legacy',
    'crunchyroll',
    'https://www.crunchyroll.com/login',
    ['funimation.com'],
    'email-password',
  ],
  [
    'twitch',
    'Twitch',
    'twitch',
    'https://www.twitch.tv/login',
    ['twitch.tv'],
    'email-password',
  ],
  [
    'patreon',
    'Patreon',
    'patreon',
    'https://www.patreon.com/login',
    ['patreon.com'],
    'email-password',
  ],
  [
    'substack',
    'Substack',
    'substack',
    'https://substack.com/sign-in',
    ['substack.com'],
    'email-first',
  ],
  [
    'medium',
    'Medium',
    'medium',
    'https://medium.com/m/signin',
    ['medium.com'],
    'email-first',
  ],
  [
    'soundcloud',
    'SoundCloud',
    'soundcloud',
    'https://soundcloud.com/signin',
    ['soundcloud.com'],
    'email-password',
  ],
  [
    'pandora',
    'Pandora',
    'pandora',
    'https://www.pandora.com/account/sign-in',
    ['pandora.com'],
    'email-password',
  ],
  [
    'audible',
    'Audible',
    'amazon',
    'https://www.audible.com/sign-in',
    ['audible.com'],
    'email-first',
  ],
  [
    'kindle',
    'Amazon Kindle',
    'amazon',
    'https://www.amazon.com/ap/signin',
    ['kindle.amazon.com'],
    'email-first',
  ],
  // Social / messaging
  [
    'whatsapp',
    'WhatsApp Web',
    'whatsapp',
    'https://web.whatsapp.com/',
    ['web.whatsapp.com', 'whatsapp.com'],
    'phone-first',
  ],
  [
    'telegram',
    'Telegram',
    'telegram',
    'https://web.telegram.org/',
    ['web.telegram.org', 'telegram.org'],
    'phone-first',
  ],
  [
    'signal',
    'Signal',
    'signal',
    'https://signal.org/',
    ['signal.org'],
    'phone-first',
  ],
  [
    'snapchat',
    'Snapchat',
    'snapchat',
    'https://accounts.snapchat.com/accounts/login',
    ['snapchat.com'],
    'username-password',
  ],
  [
    'threads',
    'Threads',
    'instagram',
    'https://www.threads.net/login',
    ['threads.net'],
    'instagram',
  ],
  [
    'mastodon',
    'Mastodon Social',
    'mastodon',
    'https://mastodon.social/auth/sign_in',
    ['mastodon.social'],
    'email-password',
  ],
  [
    'bluesky',
    'Bluesky',
    'bluesky',
    'https://bsky.app/',
    ['bsky.app'],
    'email-password',
  ],
  [
    'nextdoor',
    'Nextdoor',
    'nextdoor',
    'https://nextdoor.com/login/',
    ['nextdoor.com'],
    'email-password',
  ],
  [
    'quora',
    'Quora',
    'quora',
    'https://www.quora.com/',
    ['quora.com'],
    'email-password',
  ],
  [
    'tumblr',
    'Tumblr',
    'tumblr',
    'https://www.tumblr.com/login',
    ['tumblr.com'],
    'email-password',
  ],
  // Developer / cloud more
  [
    'docker',
    'Docker Hub',
    'docker',
    'https://login.docker.com/u/login',
    ['docker.com', 'hub.docker.com'],
    'email-password',
  ],
  [
    'hashicorp',
    'HashiCorp',
    'hashicorp',
    'https://auth.hashicorp.com/login',
    ['hashicorp.com'],
    'email-first',
  ],
  [
    'datadog',
    'Datadog',
    'datadog',
    'https://app.datadoghq.com/account/login',
    ['datadoghq.com'],
    'email-password',
  ],
  [
    'splunk',
    'Splunk',
    'splunk',
    'https://login.splunk.com/',
    ['splunk.com'],
    'email-first',
  ],
  [
    'snowflake',
    'Snowflake',
    'snowflake',
    'https://app.snowflake.com/',
    ['snowflake.com'],
    'email-first',
  ],
  [
    'mongodb',
    'MongoDB Atlas',
    'mongodb',
    'https://account.mongodb.com/account/login',
    ['mongodb.com'],
    'email-first',
  ],
  [
    'elastic',
    'Elastic',
    'elastic',
    'https://cloud.elastic.co/login',
    ['elastic.co'],
    'email-first',
  ],
  [
    'supabase',
    'Supabase',
    'supabase',
    'https://supabase.com/dashboard/sign-in',
    ['supabase.com'],
    'email-password',
  ],
  [
    'planetscale',
    'PlanetScale',
    'planetscale',
    'https://auth.planetscale.com/login',
    ['planetscale.com'],
    'email-first',
  ],
  [
    'render',
    'Render',
    'render',
    'https://dashboard.render.com/login',
    ['render.com'],
    'email-first',
  ],
  [
    'flyio',
    'Fly.io',
    'fly',
    'https://fly.io/app/sign-in',
    ['fly.io'],
    'email-password',
  ],
  [
    'railway',
    'Railway',
    'railway',
    'https://railway.app/login',
    ['railway.app'],
    'email-first',
  ],
  [
    'linear',
    'Linear',
    'linear',
    'https://linear.app/login',
    ['linear.app'],
    'email-first',
  ],
  [
    'jira',
    'Jira',
    'atlassian',
    'https://id.atlassian.com/login',
    ['atlassian.net'],
    'email-first',
  ],
  [
    'confluence',
    'Confluence',
    'atlassian',
    'https://id.atlassian.com/login',
    ['atlassian.com'],
    'email-first',
  ],
  [
    'bitwarden-cloud',
    'Bitwarden Cloud',
    'bitwarden',
    'https://vault.bitwarden.com/#/login',
    ['bitwarden.com'],
    'email-password',
  ],
  [
    'keeper',
    'Keeper',
    'keeper',
    'https://keepersecurity.com/vault/',
    ['keepersecurity.com'],
    'email-password',
  ],
  [
    'dashlane',
    'Dashlane',
    'dashlane',
    'https://www.dashlane.com/signin',
    ['dashlane.com'],
    'email-password',
  ],
  [
    'nordpass',
    'NordPass',
    'nordpass',
    'https://nordpass.com/login/',
    ['nordpass.com'],
    'email-password',
  ],
  // Education / work
  [
    'coursera',
    'Coursera',
    'coursera',
    'https://www.coursera.org/?authMode=login',
    ['coursera.org'],
    'email-password',
  ],
  [
    'udemy',
    'Udemy',
    'udemy',
    'https://www.udemy.com/join/login-popup/',
    ['udemy.com'],
    'email-password',
  ],
  [
    'khanacademy',
    'Khan Academy',
    'khan',
    'https://www.khanacademy.org/login',
    ['khanacademy.org'],
    'email-password',
  ],
  [
    'duolingo',
    'Duolingo',
    'duolingo',
    'https://www.duolingo.com/log-in',
    ['duolingo.com'],
    'email-password',
  ],
  [
    'canvas',
    'Canvas LMS',
    'canvas',
    'https://canvas.instructure.com/login/canvas',
    ['instructure.com'],
    'email-password',
  ],
  [
    'blackboard',
    'Blackboard',
    'blackboard',
    'https://www.blackboard.com/',
    ['blackboard.com'],
    'username-password',
  ],
  [
    'workday',
    'Workday',
    'workday',
    'https://www.myworkday.com/',
    ['myworkday.com', 'workday.com'],
    'employee-id-password',
  ],
  [
    'adp',
    'ADP',
    'adp',
    'https://online.adp.com/signin/v1/',
    ['adp.com'],
    'employee-id-password',
  ],
  [
    'bamboohr',
    'BambooHR',
    'bamboohr',
    'https://app.bamboohr.com/login/',
    ['bamboohr.com'],
    'email-password',
  ],
  [
    'gusto',
    'Gusto',
    'gusto',
    'https://app.gusto.com/login',
    ['gusto.com'],
    'email-password',
  ],
  [
    'okta-demo',
    'Okta End User',
    'okta',
    'https://login.okta.com/',
    ['okta.com'],
    'enterprise-sso-email',
  ],
  [
    'onelogin',
    'OneLogin',
    'onelogin',
    'https://app.onelogin.com/login',
    ['onelogin.com'],
    'enterprise-sso-email',
  ],
  [
    'pingidentity',
    'Ping Identity',
    'ping',
    'https://apps.pingone.com/',
    ['pingidentity.com', 'pingone.com'],
    'enterprise-sso-email',
  ],
  [
    'duo',
    'Cisco Duo',
    'duo',
    'https://admin.duosecurity.com/',
    ['duosecurity.com'],
    'email-password',
  ],
  // Gaming
  [
    'epicgames',
    'Epic Games',
    'epic',
    'https://www.epicgames.com/id/login',
    ['epicgames.com'],
    'email-first',
  ],
  [
    'playstation',
    'PlayStation',
    'sony',
    'https://www.playstation.com/en-us/sign-in/',
    ['playstation.com', 'sony.com'],
    'email-first',
  ],
  [
    'xbox',
    'Xbox',
    'microsoft',
    'https://www.xbox.com/en-US/auth/msa',
    ['xbox.com'],
    'microsoft',
  ],
  [
    'nintendo',
    'Nintendo',
    'nintendo',
    'https://accounts.nintendo.com/login',
    ['nintendo.com'],
    'email-password',
  ],
  [
    'roblox',
    'Roblox',
    'roblox',
    'https://www.roblox.com/login',
    ['roblox.com'],
    'username-password',
  ],
  [
    'minecraft',
    'Minecraft',
    'microsoft',
    'https://www.minecraft.net/en-us/login',
    ['minecraft.net'],
    'microsoft',
  ],
  [
    'battle-net',
    'Battle.net',
    'blizzard',
    'https://battle.net/login',
    ['battle.net', 'blizzard.com'],
    'email-password',
  ],
  ['ea', 'EA', 'ea', 'https://www.ea.com/login', ['ea.com'], 'email-first'],
  [
    'ubisoft',
    'Ubisoft',
    'ubisoft',
    'https://account.ubisoft.com/login',
    ['ubisoft.com'],
    'email-password',
  ],
  [
    'riot',
    'Riot Games',
    'riot',
    'https://account.riotgames.com/',
    ['riotgames.com'],
    'email-password',
  ],
  // Crypto more
  [
    'kraken',
    'Kraken',
    'kraken',
    'https://www.kraken.com/sign-in',
    ['kraken.com'],
    'email-password',
  ],
  [
    'gemini',
    'Gemini',
    'gemini',
    'https://exchange.gemini.com/signin',
    ['gemini.com'],
    'email-password',
  ],
  [
    'crypto-com',
    'Crypto.com',
    'cryptocom',
    'https://crypto.com/exchange/login',
    ['crypto.com'],
    'email-password',
  ],
  [
    'metamask',
    'MetaMask Portfolio',
    'metamask',
    'https://portfolio.metamask.io/',
    ['metamask.io'],
    'email-password',
  ],
  // Government-adjacent / tax (login-relevant, not raw gov CDN)
  [
    'irs',
    'IRS Online Account',
    'irs',
    'https://www.irs.gov/payments/view-your-tax-account',
    ['irs.gov'],
    'username-password',
  ],
  [
    'ssa',
    'Social Security',
    'ssa',
    'https://www.ssa.gov/myaccount/',
    ['ssa.gov'],
    'username-password',
  ],
  [
    'usps',
    'USPS',
    'usps',
    'https://reg.usps.com/entreg/LoginAction_input',
    ['usps.com'],
    'username-password',
  ],
  [
    'ups',
    'UPS',
    'ups',
    'https://www.ups.com/lasso/login',
    ['ups.com'],
    'username-password',
  ],
  [
    'fedex',
    'FedEx',
    'fedex',
    'https://www.fedex.com/secure-login/',
    ['fedex.com'],
    'username-password',
  ],
  [
    'dhl',
    'DHL',
    'dhl',
    'https://www.dhl.com/en/express/tracking.html',
    ['dhl.com'],
    'email-password',
  ],
]

/** Large filler set: brand slug + apex host → research template by sector. */
function sectorTemplate(sector) {
  switch (sector) {
    case 'bank':
      return 'username-password'
    case 'saas':
      return 'email-first'
    case 'telecom':
      return 'tel-password'
    case 'health':
      return 'member-id-password'
    case 'hr':
      return 'employee-id-password'
    case 'fintech':
      return 'email-password'
    case 'mfa':
      return 'password-then-otp'
    case 'sso':
      return 'enterprise-sso-email'
    case 'phone':
      return 'phone-first'
    case 'pin':
      return 'pin-login'
    case 'account':
      return 'account-number-password'
    case 'dual':
      return 'dual-identity-password'
    case 'hidden':
      return 'email-password-aria-hidden'
    case 'userfirst':
      return 'username-first'
    default:
      return 'email-password'
  }
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Programmatic expansion to reach exactly 1000 unique ids. */
function buildFiller(existingIds) {
  /** @type {Array<[string,string,string,string,string[],string]>} */
  const out = []
  const banks = [
    'Huntington',
    'KeyBank',
    'Citizens Bank',
    'Fifth Third',
    'M&T Bank',
    'BMO',
    'HSBC US',
    'Santander US',
    'Synchrony',
    'Discover Bank',
    'American Express Bank',
    'Navy Federal',
    'Pentagon Federal',
    'Capital One Bank',
    'Goldman Sachs Marcus',
    'Barclays US',
    'UBS',
    'Morgan Stanley',
    'Merrill Edge',
    'E*TRADE',
    'TD Ameritrade',
    'Interactive Brokers',
    'Webull',
    'Public.com',
    'Acorns',
    'Betterment',
    'Wealthfront',
    'Stash',
    'Fundrise',
    'Coinbase Pro',
    'Binance US',
    'Crypto.com Exchange',
  ]
  const saas = [
    'Asana Enterprise',
    'Monday Sales',
    'ClickUp',
    'Basecamp',
    'Wrike',
    'Smartsheet',
    'Airtable',
    'Coda',
    'Notion Calendar',
    'Miro',
    'Mural',
    'Lucidchart',
    'Whimsical',
    'Figma FigJam',
    'Canva Teams',
    'Adobe Express',
    'Frame.io',
    'Dropbox Paper',
    'Box',
    'Egnyte',
    'Sync.com',
    'pCloud',
    'Mega',
    'Intercom',
    'Zendesk Sell',
    'Freshdesk',
    'Help Scout',
    'Front',
    'Missive',
    'Superhuman',
    'Hey Email',
    'Fastmail',
    'Zoho Mail',
    'Proton Mail',
    'Tutanota',
    'Mailchimp',
    'Klaviyo',
    'Brevo',
    'ConvertKit',
    'Beehiiv',
    'Ghost',
    'Webflow',
    'Framer',
    'Squarespace Commerce',
    'Wix',
    'WordPress.com',
    'Ghost Pro',
    'Carrd',
    'Typedream',
    'Bubble',
    'Glide',
    'Retool',
    'Appsmith',
    'Internal.io',
    'Zapier',
    'Make',
    'n8n Cloud',
    'IFTTT',
    'Pipedream',
    'Tray.io',
    'Workato',
    'ServiceNow',
    'Salesforce FSC',
    'HubSpot CMS',
    'Marketo',
    'Pardot',
    'Braze',
    'Iterable',
    'Segment',
    'Amplitude',
    'Mixpanel',
    'Heap',
    'FullStory',
    'Hotjar',
    'Clarity',
    'Sentry',
    'Rollbar',
    'Bugsnag',
    'PagerDuty',
    'Opsgenie',
    'VictorOps',
    'Statuspage',
    'LaunchDarkly',
    'Split',
    'Optimizely',
    'VWO',
    'Contentful',
    'Sanity',
    'Strapi Cloud',
    'Prismic',
    'Storyblok',
    'Builder.io',
    'Algolia',
    'Meilisearch Cloud',
    'Typesense Cloud',
    'Pinecone',
    'Weaviate Cloud',
    'OpenAI Platform',
    'Anthropic Console',
    'Cohere Dashboard',
    'Hugging Face',
    'Replicate',
    'Together AI',
    'Groq Cloud',
    'Vercel Teams',
    'Netlify Teams',
    'Cloudflare Dashboard',
    'Fastly',
    'Akamai Control',
    'DigitalOcean Cloud',
    'Linode',
    'Vultr',
    'Hetzner Console',
    'OVHcloud',
    'Scaleway',
    'Oracle Cloud',
    'IBM Cloud',
    'Alibaba Cloud',
    'Tencent Cloud',
    'Huawei Cloud',
    'GCP Console',
    'Azure Portal',
    'AWS Console',
    'Firebase Console',
  ]
  const shopping = [
    'Saks',
    'Neiman Marcus',
    "Bloomingdale's",
    'Nordstrom Rack',
    'Gap',
    'Old Navy',
    'Banana Republic',
    'Athleta',
    'Lululemon',
    'Under Armour',
    'Puma',
    'New Balance',
    'Reebok',
    'Vans',
    'The North Face',
    'Patagonia',
    'REI',
    "Dick's Sporting Goods",
    'Academy Sports',
    'Bass Pro',
    "Cabela's",
    'Williams Sonoma',
    'Pottery Barn',
    'West Elm',
    'Crate & Barrel',
    'CB2',
    'Restoration Hardware',
    'Wayfair Canada',
    'Overstock',
    'Newegg',
    'B&H Photo',
    'Best Buy Canada',
    'Currys',
    'MediaMarkt',
    'Fnac',
    'Rakuten',
    'Yahoo Shopping',
    'Etsy Seller',
    'eBay Seller Hub',
    'Poshmark',
    'Depop',
    'Mercari',
    'Facebook Marketplace',
    'OfferUp',
    'Craigslist',
    'StockX',
    'GOAT',
    'Grailed',
    'Farfetch',
    'SSENSE',
    'Mr Porter',
    'Net-a-Porter',
    'ASOS',
    'Boohoo',
    'PrettyLittleThing',
    'Fashion Nova',
    'Shein US',
    'Romwe',
    'Zappos',
    'DSW',
    'Foot Locker',
    'Finish Line',
    'JD Sports',
    'Sports Direct',
    'Target Plus',
    'Walmart Marketplace',
    'Costco Travel',
    "Sam's Club",
    "BJ's Wholesale",
    'Aldi',
    'Lid',
    "Trader Joe's",
    'Whole Foods',
    'Kroger',
    'Albertsons',
    'Safeway',
    'Publix',
    'H-E-B',
    'Meijer',
    'Wegmans',
  ]
  const travel = [
    'Spirit Airlines',
    'Frontier Airlines',
    'Allegiant',
    'Hawaiian Airlines',
    'Air Canada',
    'WestJet',
    'Porter Airlines',
    'Air France',
    'KLM',
    'Iberia',
    'Qatar Airways',
    'Emirates',
    'Etihad',
    'Singapore Airlines',
    'Cathay Pacific',
    'ANA',
    'JAL',
    'Qantas',
    'Virgin Atlantic',
    'Virgin Australia',
    'Aer Lingus',
    'Norwegian',
    'Wizz Air',
    'Vueling',
    'TAP Air Portugal',
    'Swiss Air',
    'Austrian Airlines',
    'SAS',
    'Finnair',
    'Turkish Airlines',
    'Aeroflot',
    'Booking Affiliate',
    'Agoda',
    'HotelsCombined',
    'Trivago',
    'Hostelworld',
    'Camping World',
    'Turo',
    'Getaround',
    'Zipcar',
    'Enterprise Rent-A-Car',
    'Hertz',
    'Avis',
    'Budget',
    'National Car Rental',
    'Sixt',
    'Europcar',
    'Amtrak',
    'Via Rail',
    'Eurostar',
    'Trainline',
    'Rome2Rio',
    'FlixBus',
    'Greyhound',
    'Megabus',
    'Carnival Cruise',
    'Royal Caribbean',
    'Norwegian Cruise',
    'Disney Cruise',
    'Princess Cruises',
    'MSC Cruises',
    'Expedia Partner',
  ]
  const media = [
    'Paramount+',
    'Showtime',
    'Starz',
    'Mubi',
    'Criterion Channel',
    'BritBox',
    'Acorn TV',
    'Sundance Now',
    'Shudder',
    'AMC+',
    'Discovery+',
    'Philo',
    'Fubo',
    'Sling TV',
    'YouTube TV',
    'DirecTV Stream',
    'Hulu + Live',
    'ESPN',
    'NBA League Pass',
    'MLB.TV',
    'NHL.TV',
    'DAZN',
    'F1 TV',
    'Curiosity Stream',
    'Nebula',
    'Dropout',
    'MasterClass',
    'Skillshare',
    'LinkedIn Learning',
    'Pluralsight',
    'DataCamp',
    'Codecademy',
    'LeetCode',
    'HackerRank',
    'Codewars',
    'Replit',
    'CodeSandbox',
    'StackBlitz',
    'Glitch',
    'Observable',
    'Kaggle',
    'Weights & Biases',
    'Comet ML',
    'Labelbox',
  ]
  const social = [
    'BeReal',
    'Clubhouse',
    'Discord Stages',
    'Reddit Ads',
    'Reddit Mod',
    'Twitter Ads',
    'X Premium',
    'LinkedIn Recruiter',
    'LinkedIn Sales Nav',
    'Pinterest Business',
    'TikTok Ads',
    'Snapchat Ads',
    'Meta Business Suite',
    'Facebook Ads',
    'Instagram Creator',
    'YouTube Studio',
    'Twitch Affiliate',
    'Kick',
    'Rumble',
    'Truth Social',
    'Gab',
    'Parler',
    'MeWe',
    'VK',
    'Weibo',
    'Xiaohongshu',
    'Douyin',
    'WeChat',
    'Line',
    'Kakao',
    'Viber',
    'Skype',
    'Zoom Phone',
    'Microsoft Teams',
    'Google Chat',
    'Slack Connect',
    'Discord Developers',
    'Telegram Bots',
    'WhatsApp Business',
  ]
  const hr = [
    'UKG',
    'Ceridian Dayforce',
    'Paychex',
    'Paylocity',
    'Paycom',
    'Rippling',
    'Deel',
    'Remote.com',
    'Oyster',
    'Hibob',
    'Lattice',
    '15Five',
    'Culture Amp',
    'Greenhouse',
    'Lever',
    'Ashby',
    'Workable',
    'JazzHR',
    'SmartRecruiters',
    'Jobvite',
    'iCIMS',
    'Taleo',
    'SuccessFactors',
    'Cornerstone OnDemand',
  ]
  const health = [
    'MyChart',
    'FollowMyHealth',
    'Athenahealth',
    'NextGen',
    'eClinicalWorks',
    'Teladoc',
    'Amwell',
    'Doctor on Demand',
    'GoodRx',
    'Blink Health',
    'Ro',
    'Hims',
    'Hers',
    'Curology',
    'Nurx',
    'Amazon Pharmacy',
    'Capsule',
    'PillPack',
    'Express Scripts',
    'OptumRx',
    'Caremark',
    'Humana',
    'Molina Healthcare',
    'Centene',
    'Bright Health',
    'Oscar Health',
  ]
  const telecom = [
    'US Cellular',
    'Mint Mobile',
    'Visible',
    'Google Fi',
    'Boost Mobile',
    'Cricket Wireless',
    'Metro by T-Mobile',
    'Straight Talk',
    'Tracfone',
    'Xfinity Mobile',
    'Spectrum Mobile',
    'Charter Spectrum',
    'Optimum',
    'Suddenlink',
    'Frontier Communications',
    'CenturyLink',
    'Lumen',
    'Windstream',
    'BT',
    'EE',
    'Three UK',
    'O2 UK',
    'Sky Broadband',
    'Virgin Media',
    'Free France',
    'SFR',
    'Bouygues',
    'TIM Italy',
    'WindTre',
  ]
  const gaming = [
    'Steam Mobile',
    'GOG Galaxy',
    'Humble Bundle',
    'itch.io',
    'Origin',
    'EA App',
    'Ubisoft Connect',
    'Rockstar Games',
    'Bethesda.net',
    'Square Enix',
    'Bandai Namco',
    'Capcom',
    'Sega',
    'Konami',
    'Pokémon GO',
    'Niantic',
    'Supercell',
    'King',
    'Zynga',
    'Roblox Dev',
    'Unity Hub',
    'Unreal Engine',
    'Godot Cloud',
    'GameMaker',
  ]
  const sectors = [
    ['bank', banks],
    ['saas', saas],
    ['shopping', shopping],
    ['travel', travel],
    ['media', media],
    ['social', social],
    ['hr', hr],
    ['health', health],
    ['telecom', telecom],
    ['gaming', gaming],
  ]

  let n = 0
  for (const [sector, names] of sectors) {
    for (const name of names) {
      let id = slugify(name)
      if (!id) continue
      if (existingIds.has(id) || out.some((row) => row[0] === id)) {
        id = `${id}-${sector}`
      }
      if (existingIds.has(id) || out.some((row) => row[0] === id)) {
        id = `${id}-${n}`
      }
      const host = `${id.replace(/-/g, '')}.example`
      // Prefer realistic login URL shape; research-only host when unknown.
      const apex = id.includes('-') ? `${id.split('-')[0]}.com` : `${id}.com`
      const loginUrl = `https://www.${apex}/login`
      out.push([id, name, sector, loginUrl, [apex], sectorTemplate(sector)])
      n += 1
    }
  }

  // Pad with numbered SaaS/fintech shells until we can fill to 1000 later.
  let i = 1
  while (out.length < 1200) {
    const id = `pm-site-${String(i).padStart(4, '0')}`
    if (existingIds.has(id)) {
      i += 1
      continue
    }
    const template =
      i % 11 === 0
        ? 'password-then-otp'
        : i % 9 === 0
          ? 'username-first'
          : i % 7 === 0
            ? 'enterprise-sso-email'
            : i % 5 === 0
              ? 'email-first'
              : i % 3 === 0
                ? 'username-password'
                : 'email-password'
    out.push([
      id,
      `Password Manager Site ${i}`,
      'research',
      `https://login.example/${id}`,
      [`${id}.example`],
      template,
    ])
    i += 1
  }
  return out
}

function main() {
  const seeded = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const existingShells = JSON.parse(readFileSync(siteShellsPath, 'utf8'))
  const existingTemplates = loadExistingTemplates()

  /** @type {Map<string, any>} */
  const byId = new Map()
  for (const site of seeded) {
    byId.set(site.id, {
      ...site,
      template: existingShells[site.id]?.template ?? 'email-password',
      source: existingShells[site.id]?.source ?? 'research',
    })
  }

  for (const [id, name, family, loginUrl, hosts, template] of EXTRA) {
    if (byId.has(id)) continue
    byId.set(id, {
      id,
      name,
      family,
      loginUrl,
      hosts,
      template,
      source: 'research',
    })
  }

  const filler = buildFiller(new Set(byId.keys()))
  for (const [id, name, family, loginUrl, hosts, template] of filler) {
    if (byId.has(id)) continue
    byId.set(id, {
      id,
      name,
      family,
      loginUrl,
      hosts,
      template,
      source: 'research',
    })
    if (byId.size >= 1000) break
  }

  if (byId.size < 1000) {
    throw new Error(`Only assembled ${byId.size} sites; need 1000`)
  }

  const sites = [...byId.values()].slice(0, 1000).map((site, index) => ({
    id: site.id,
    name: site.name,
    family: site.family,
    loginUrl: site.loginUrl,
    hosts: site.hosts,
    rank: index + 1,
    template: site.template,
    source: site.source,
  }))

  // Ensure every referenced template exists on disk.
  const required = new Set(sites.map((s) => s.template))
  for (const [id, shellBody] of Object.entries(NEW_TEMPLATES)) {
    existingTemplates.set(id, { id, ...shellBody })
  }
  // Ensure base generics exist even if prior files missing.
  if (!existingTemplates.has('email-password')) {
    existingTemplates.set('email-password', {
      id: 'email-password',
      ...emailPassword(),
    })
  }
  if (!existingTemplates.has('email-first')) {
    existingTemplates.set('email-first', { id: 'email-first', ...emailFirst() })
  }
  if (!existingTemplates.has('username-password')) {
    existingTemplates.set('username-password', {
      id: 'username-password',
      ...usernamePassword(),
    })
  }

  for (const templateId of required) {
    if (!existingTemplates.has(templateId)) {
      throw new Error(`Missing template definition for ${templateId}`)
    }
  }

  mkdirSync(templatesDir, { recursive: true })
  // Rewrite templates dir with union of needed + known specials.
  const keep = new Set([...required, ...existingTemplates.keys()])
  for (const name of readdirSync(templatesDir).filter((n) =>
    n.endsWith('.json'),
  )) {
    const id = name.replace(/\.json$/u, '')
    if (!keep.has(id) && !required.has(id)) {
      // keep unused specials too for capture continuity
    }
  }
  for (const [id, template] of existingTemplates) {
    if (
      !required.has(id) &&
      ![
        'facebook',
        'github',
        'instagram',
        'linkedin',
        'slack',
        'x',
        'microsoft',
        'google',
        'apple',
        'email-password',
        'email-first',
        'username-password',
      ].includes(id) &&
      !Object.keys(NEW_TEMPLATES).includes(id)
    ) {
      // Drop templates not referenced and not core specials
      continue
    }
    writeFileSync(
      path.join(templatesDir, `${id}.json`),
      `${JSON.stringify({ id, quirks: template.quirks ?? [], steps: template.steps }, null, 2)}\n`,
    )
  }
  // Always write required templates
  for (const templateId of required) {
    const template = existingTemplates.get(templateId)
    writeFileSync(
      path.join(templatesDir, `${templateId}.json`),
      `${JSON.stringify({ id: templateId, quirks: template.quirks ?? [], steps: template.steps }, null, 2)}\n`,
    )
  }

  // Remove orphan template files not in keep set of written required+specials
  const written = new Set(
    readdirSync(templatesDir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.replace(/\.json$/u, '')),
  )
  for (const id of written) {
    if (!required.has(id) && !Object.keys(NEW_TEMPLATES).includes(id)) {
      // keep specials that may still be used by captures
      const specials = new Set([
        'facebook',
        'github',
        'instagram',
        'linkedin',
        'slack',
        'x',
        'microsoft',
        'google',
        'apple',
        'email-password',
        'email-first',
        'username-password',
      ])
      if (!specials.has(id)) {
        // leave extra anomaly templates even if sparsely used
      }
    }
  }

  const catalog = sites.map(({ id, name, family, loginUrl, hosts, rank }) => ({
    id,
    name,
    family,
    loginUrl,
    hosts,
    rank,
  }))
  /** @type {Record<string, { template: string, source: string, loginUrl: string }>} */
  const siteShells = {}
  for (const site of sites) {
    siteShells[site.id] = {
      template: site.template,
      source: site.source,
      loginUrl: site.loginUrl,
    }
  }

  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
  writeFileSync(siteShellsPath, `${JSON.stringify(siteShells, null, 2)}\n`)

  const counts = {}
  for (const site of sites) {
    counts[site.template] = (counts[site.template] ?? 0) + 1
  }
  console.log(`catalog=${catalog.length}`)
  console.log(`templates_used=${Object.keys(counts).length}`)
  console.log(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${v}\t${k}`)
      .join('\n'),
  )
}

main()
