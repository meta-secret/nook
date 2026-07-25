#!/usr/bin/env node
/**
 * Generates popular_login_sites.json (100 entries) and mock-auth fixtures.
 * Research-based structural shells; capture-login-shell.mjs can overwrite with live drafts.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

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
const legacySitesDir = path.join(fixturesRoot, 'sites')

/** @typedef {{ name: string, type?: string, id?: string, autocomplete?: string, placeholder?: string, 'aria-label'?: string, 'data-qa'?: string, 'data-testid'?: string }} Field */
/** @typedef {{ fields: Field[], submit: { type?: string, name?: string, id?: string, label: string } }} Step */

function field(partial) {
  return {
    type: 'text',
    ...partial,
  }
}

function emailPassword({
  emailName = 'email',
  emailType = 'email',
  passName = 'password',
  emailAutocomplete = 'username',
  quirks = [],
  submitLabel = 'Sign in',
} = {}) {
  return {
    quirks,
    steps: [
      {
        fields: [
          field({
            name: emailName,
            type: emailType,
            autocomplete: emailAutocomplete,
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
          field({
            name: passName,
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: submitLabel },
      },
    ],
  }
}

function usernamePassword({
  userName = 'username',
  passName = 'password',
  submitLabel = 'Sign in',
  quirks = [],
} = {}) {
  return {
    quirks,
    steps: [
      {
        fields: [
          field({
            name: userName,
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Username',
            'aria-label': 'Username',
          }),
          field({
            name: passName,
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: submitLabel },
      },
    ],
  }
}

function emailFirst({
  emailName = 'email',
  emailType = 'email',
  passName = 'password',
  continueLabel = 'Continue',
  signInLabel = 'Sign in',
  quirks = [],
} = {}) {
  return {
    quirks,
    steps: [
      {
        fields: [
          field({
            name: emailName,
            type: emailType,
            autocomplete: 'username',
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
        ],
        submit: { type: 'submit', label: continueLabel },
      },
      {
        fields: [
          field({
            name: emailName,
            type: emailType,
            autocomplete: 'username',
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
          field({
            name: passName,
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: signInLabel },
      },
    ],
  }
}

/** Special known shells from existing Tier-1 fixtures. */
const SPECIAL = {
  microsoft: {
    quirks: [],
    steps: [
      {
        fields: [
          field({
            name: 'loginfmt',
            type: 'email',
            id: 'i0116',
            placeholder: 'Email, phone, or Skype',
            'aria-label': 'Enter your email, phone, or Skype.',
          }),
        ],
        submit: { type: 'submit', id: 'idSIButton9', label: 'Next' },
      },
      {
        fields: [
          field({
            name: 'loginfmt',
            type: 'email',
            id: 'i0116',
            placeholder: 'Email, phone, or Skype',
            'aria-label': 'Enter your email, phone, or Skype.',
          }),
          field({
            name: 'passwd',
            type: 'password',
            id: 'i0118',
            autocomplete: 'current-password',
            placeholder: 'Password',
          }),
        ],
        submit: { type: 'submit', id: 'idSIButton9', label: 'Sign in' },
      },
    ],
  },
  google: {
    quirks: [],
    steps: [
      {
        fields: [
          field({
            name: 'identifier',
            type: 'email',
            id: 'identifierId',
            autocomplete: 'username',
            placeholder: 'Email or phone',
            'aria-label': 'Email or phone',
          }),
        ],
        submit: { type: 'submit', label: 'Next' },
      },
      {
        fields: [
          field({
            name: 'identifier',
            type: 'email',
            id: 'identifierId',
            autocomplete: 'username',
            placeholder: 'Email or phone',
            'aria-label': 'Email or phone',
          }),
          field({
            name: 'Passwd',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Enter your password',
            'aria-label': 'Enter your password',
          }),
        ],
        submit: { type: 'submit', label: 'Next' },
      },
    ],
  },
  slack: {
    quirks: [],
    steps: [
      {
        fields: [
          field({
            name: 'email',
            type: 'email',
            id: 'email',
            'data-qa': 'login_email',
            placeholder: 'name@work-email.com',
          }),
        ],
        submit: {
          type: 'button',
          'data-qa': 'signin_button',
          label: 'Sign In',
        },
      },
      {
        fields: [
          field({
            name: 'email',
            type: 'email',
            id: 'email',
            'data-qa': 'login_email',
            placeholder: 'name@work-email.com',
          }),
          field({
            name: 'password',
            type: 'password',
            id: 'password',
            'data-qa': 'login_password',
            autocomplete: 'current-password',
          }),
        ],
        submit: { type: 'submit', 'data-qa': 'signin_btn', label: 'Sign In' },
      },
    ],
  },
  facebook: {
    quirks: ['aria-hidden-ancestor'],
    steps: [
      {
        fields: [
          field({
            name: 'email',
            type: 'text',
            id: 'email',
            placeholder: 'Email or phone number',
            'aria-label': 'Email or phone number',
          }),
          field({
            name: 'pass',
            type: 'password',
            id: 'pass',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: {
          type: 'submit',
          name: 'login',
          id: 'loginbutton',
          label: 'Log in',
        },
      },
    ],
  },
  apple: {
    quirks: [],
    steps: [
      {
        fields: [
          field({
            name: 'accountName',
            type: 'text',
            id: 'account_name_text_field',
            autocomplete: 'username',
            placeholder: 'Apple ID',
            'aria-label': 'Apple ID or email',
          }),
          field({
            name: 'password',
            type: 'password',
            id: 'password_text_field',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign In' },
      },
    ],
  },
  amazon: emailFirst({
    emailName: 'email',
    passName: 'password',
    continueLabel: 'Continue',
    signInLabel: 'Sign in',
  }),
  github: {
    quirks: [],
    steps: [
      {
        fields: [
          field({
            name: 'login',
            type: 'text',
            id: 'login_field',
            autocomplete: 'username',
            placeholder: 'Username or email address',
            'aria-label': 'Username or email address',
          }),
          field({
            name: 'password',
            type: 'password',
            id: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', name: 'commit', label: 'Sign in' },
      },
    ],
  },
  linkedin: {
    quirks: [],
    steps: [
      {
        fields: [
          field({
            name: 'session_key',
            type: 'text',
            id: 'username',
            autocomplete: 'username',
            placeholder: 'Email or phone',
            'aria-label': 'Email or phone',
          }),
          field({
            name: 'session_password',
            type: 'password',
            id: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Sign in' },
      },
    ],
  },
  x: {
    quirks: [],
    steps: [
      {
        fields: [
          field({
            name: 'text',
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Phone, email, or username',
            'aria-label': 'Phone, email, or username',
            'data-testid': 'ocfEnterTextTextInput',
          }),
        ],
        submit: { type: 'submit', label: 'Next' },
      },
      {
        fields: [
          field({
            name: 'text',
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Phone, email, or username',
            'aria-label': 'Phone, email, or username',
            'data-testid': 'ocfEnterTextTextInput',
          }),
          field({
            name: 'password',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: 'Log in' },
      },
    ],
  },
  instagram: emailPassword({
    emailName: 'username',
    emailType: 'text',
    passName: 'password',
    submitLabel: 'Log in',
  }),
}

/**
 * Curated password-manager-relevant top 100.
 * rank is 1-based popularity within this catalog.
 */
const SITES = [
  [
    'google',
    'Google',
    'google',
    'https://accounts.google.com/ServiceLogin',
    ['accounts.google.com', 'google.com', 'gmail.com'],
  ],
  [
    'facebook',
    'Facebook',
    'facebook',
    'https://www.facebook.com/login',
    ['facebook.com', 'm.facebook.com', 'fb.com'],
  ],
  [
    'amazon',
    'Amazon',
    'amazon',
    'https://www.amazon.com/ap/signin',
    ['amazon.com', 'smile.amazon.com'],
  ],
  [
    'microsoft',
    'Microsoft',
    'microsoft',
    'https://login.live.com/',
    ['login.live.com', 'microsoft.com', 'outlook.com', 'live.com'],
  ],
  [
    'apple',
    'Apple',
    'apple',
    'https://appleid.apple.com/sign-in',
    ['appleid.apple.com', 'apple.com', 'icloud.com'],
  ],
  [
    'youtube',
    'YouTube',
    'google',
    'https://accounts.google.com/ServiceLogin?service=youtube',
    ['youtube.com'],
  ],
  [
    'instagram',
    'Instagram',
    'instagram',
    'https://www.instagram.com/accounts/login/',
    ['instagram.com'],
  ],
  ['x', 'X', 'x', 'https://x.com/i/flow/login', ['x.com', 'twitter.com']],
  [
    'yahoo',
    'Yahoo',
    'yahoo',
    'https://login.yahoo.com/',
    ['login.yahoo.com', 'yahoo.com'],
  ],
  [
    'reddit',
    'Reddit',
    'reddit',
    'https://www.reddit.com/login/',
    ['reddit.com'],
  ],
  [
    'linkedin',
    'LinkedIn',
    'linkedin',
    'https://www.linkedin.com/login',
    ['linkedin.com'],
  ],
  [
    'netflix',
    'Netflix',
    'netflix',
    'https://www.netflix.com/login',
    ['netflix.com'],
  ],
  [
    'tiktok',
    'TikTok',
    'tiktok',
    'https://www.tiktok.com/login',
    ['tiktok.com'],
  ],
  [
    'office',
    'Microsoft 365',
    'microsoft',
    'https://login.microsoftonline.com/',
    ['office.com', 'office365.com', 'login.microsoftonline.com'],
  ],
  [
    'ebay',
    'eBay',
    'ebay',
    'https://signin.ebay.com/ws/eBayISAPI.dll',
    ['ebay.com', 'signin.ebay.com'],
  ],
  [
    'paypal',
    'PayPal',
    'paypal',
    'https://www.paypal.com/signin',
    ['paypal.com'],
  ],
  [
    'discord',
    'Discord',
    'discord',
    'https://discord.com/login',
    ['discord.com'],
  ],
  ['twitch', 'Twitch', 'twitch', 'https://www.twitch.tv/login', ['twitch.tv']],
  [
    'spotify',
    'Spotify',
    'spotify',
    'https://accounts.spotify.com/login',
    ['accounts.spotify.com', 'spotify.com'],
  ],
  [
    'pinterest',
    'Pinterest',
    'pinterest',
    'https://www.pinterest.com/login/',
    ['pinterest.com'],
  ],
  ['github', 'GitHub', 'github', 'https://github.com/login', ['github.com']],
  ['zoom', 'Zoom', 'zoom', 'https://zoom.us/signin', ['zoom.us']],
  [
    'dropbox',
    'Dropbox',
    'dropbox',
    'https://www.dropbox.com/login',
    ['dropbox.com'],
  ],
  [
    'adobe',
    'Adobe',
    'adobe',
    'https://auth.services.adobe.com/en_US/index.html',
    ['adobe.com', 'auth.services.adobe.com'],
  ],
  [
    'salesforce',
    'Salesforce',
    'salesforce',
    'https://login.salesforce.com/',
    ['login.salesforce.com', 'salesforce.com'],
  ],
  [
    'slack',
    'Slack',
    'slack',
    'https://slack.com/signin',
    ['slack.com', 'app.slack.com'],
  ],
  [
    'steam',
    'Steam',
    'steam',
    'https://store.steampowered.com/login/',
    ['steampowered.com', 'store.steampowered.com'],
  ],
  [
    'walmart',
    'Walmart',
    'walmart',
    'https://www.walmart.com/account/login',
    ['walmart.com'],
  ],
  [
    'target',
    'Target',
    'target',
    'https://www.target.com/account',
    ['target.com'],
  ],
  [
    'bestbuy',
    'Best Buy',
    'bestbuy',
    'https://www.bestbuy.com/identity/global/signin',
    ['bestbuy.com'],
  ],
  [
    'costco',
    'Costco',
    'costco',
    'https://www.costco.com/LogonForm',
    ['costco.com'],
  ],
  [
    'homedepot',
    'Home Depot',
    'homedepot',
    'https://www.homedepot.com/auth/view/signin',
    ['homedepot.com'],
  ],
  [
    'lowes',
    "Lowe's",
    'lowes',
    'https://www.lowes.com/myaccount',
    ['lowes.com'],
  ],
  ['etsy', 'Etsy', 'etsy', 'https://www.etsy.com/signin', ['etsy.com']],
  [
    'airbnb',
    'Airbnb',
    'airbnb',
    'https://www.airbnb.com/login',
    ['airbnb.com'],
  ],
  [
    'uber',
    'Uber',
    'uber',
    'https://auth.uber.com/v2/',
    ['auth.uber.com', 'uber.com'],
  ],
  [
    'lyft',
    'Lyft',
    'lyft',
    'https://account.lyft.com/auth',
    ['lyft.com', 'account.lyft.com'],
  ],
  [
    'doordash',
    'DoorDash',
    'doordash',
    'https://www.doordash.com/consumer/login/',
    ['doordash.com'],
  ],
  [
    'grubhub',
    'Grubhub',
    'grubhub',
    'https://www.grubhub.com/login',
    ['grubhub.com'],
  ],
  [
    'chase',
    'Chase',
    'chase',
    'https://secure.chase.com/web/auth/',
    ['chase.com', 'secure.chase.com'],
  ],
  [
    'bankofamerica',
    'Bank of America',
    'bankofamerica',
    'https://www.bankofamerica.com/',
    ['bankofamerica.com'],
  ],
  [
    'wellsfargo',
    'Wells Fargo',
    'wellsfargo',
    'https://connect.secure.wellsfargo.com/auth/login',
    ['wellsfargo.com'],
  ],
  [
    'citi',
    'Citi',
    'citi',
    'https://online.citi.com/US/login.do',
    ['citi.com', 'online.citi.com'],
  ],
  [
    'capitalone',
    'Capital One',
    'capitalone',
    'https://verified.capitalone.com/auth/signin',
    ['capitalone.com'],
  ],
  [
    'usbank',
    'U.S. Bank',
    'usbank',
    'https://www.usbank.com/index.html',
    ['usbank.com'],
  ],
  [
    'americanexpress',
    'American Express',
    'americanexpress',
    'https://www.americanexpress.com/en-us/account/login',
    ['americanexpress.com'],
  ],
  [
    'discover',
    'Discover',
    'discover',
    'https://portal.discover.com/customersvcs/universalLogin/ac_main',
    ['discover.com'],
  ],
  [
    'schwab',
    'Charles Schwab',
    'schwab',
    'https://www.schwab.com/login',
    ['schwab.com'],
  ],
  [
    'fidelity',
    'Fidelity',
    'fidelity',
    'https://digital.fidelity.com/prgw/digital/login',
    ['fidelity.com'],
  ],
  [
    'vanguard',
    'Vanguard',
    'vanguard',
    'https://investor.vanguard.com/my-account/log-on',
    ['vanguard.com'],
  ],
  [
    'robinhood',
    'Robinhood',
    'robinhood',
    'https://robinhood.com/login',
    ['robinhood.com'],
  ],
  [
    'coinbase',
    'Coinbase',
    'coinbase',
    'https://login.coinbase.com/',
    ['coinbase.com', 'login.coinbase.com'],
  ],
  [
    'binance',
    'Binance',
    'binance',
    'https://accounts.binance.com/en/login',
    ['binance.com', 'accounts.binance.com'],
  ],
  [
    'paypalme',
    'Venmo',
    'venmo',
    'https://account.venmo.com/sign-in',
    ['venmo.com', 'account.venmo.com'],
  ],
  ['cashapp', 'Cash App', 'cashapp', 'https://cash.app/login', ['cash.app']],
  [
    'stripe',
    'Stripe',
    'stripe',
    'https://dashboard.stripe.com/login',
    ['stripe.com', 'dashboard.stripe.com'],
  ],
  [
    'shopify',
    'Shopify',
    'shopify',
    'https://accounts.shopify.com/store-login',
    ['shopify.com', 'accounts.shopify.com'],
  ],
  [
    'squarespace',
    'Squarespace',
    'squarespace',
    'https://login.squarespace.com/',
    ['squarespace.com', 'login.squarespace.com'],
  ],
  [
    'wordpress',
    'WordPress.com',
    'wordpress',
    'https://wordpress.com/log-in',
    ['wordpress.com'],
  ],
  [
    'cloudflare',
    'Cloudflare',
    'cloudflare',
    'https://dash.cloudflare.com/login',
    ['cloudflare.com', 'dash.cloudflare.com'],
  ],
  [
    'aws',
    'AWS',
    'amazon',
    'https://signin.aws.amazon.com/',
    ['signin.aws.amazon.com', 'aws.amazon.com'],
  ],
  [
    'azure',
    'Azure',
    'microsoft',
    'https://portal.azure.com/',
    ['azure.com', 'portal.azure.com'],
  ],
  [
    'digitalocean',
    'DigitalOcean',
    'digitalocean',
    'https://cloud.digitalocean.com/login',
    ['digitalocean.com'],
  ],
  [
    'heroku',
    'Heroku',
    'heroku',
    'https://id.heroku.com/login',
    ['heroku.com', 'id.heroku.com'],
  ],
  ['vercel', 'Vercel', 'vercel', 'https://vercel.com/login', ['vercel.com']],
  [
    'netlify',
    'Netlify',
    'netlify',
    'https://app.netlify.com/login',
    ['netlify.com', 'app.netlify.com'],
  ],
  [
    'gitlab',
    'GitLab',
    'gitlab',
    'https://gitlab.com/users/sign_in',
    ['gitlab.com'],
  ],
  [
    'bitbucket',
    'Bitbucket',
    'bitbucket',
    'https://bitbucket.org/account/signin/',
    ['bitbucket.org'],
  ],
  [
    'atlassian',
    'Atlassian',
    'atlassian',
    'https://id.atlassian.com/login',
    ['atlassian.com', 'id.atlassian.com'],
  ],
  ['notion', 'Notion', 'notion', 'https://www.notion.so/login', ['notion.so']],
  ['figma', 'Figma', 'figma', 'https://www.figma.com/login', ['figma.com']],
  ['canva', 'Canva', 'canva', 'https://www.canva.com/login', ['canva.com']],
  [
    'asana',
    'Asana',
    'asana',
    'https://app.asana.com/-/login',
    ['asana.com', 'app.asana.com'],
  ],
  ['trello', 'Trello', 'atlassian', 'https://trello.com/login', ['trello.com']],
  [
    'monday',
    'monday.com',
    'monday',
    'https://auth.monday.com/login',
    ['monday.com', 'auth.monday.com'],
  ],
  [
    'hubspot',
    'HubSpot',
    'hubspot',
    'https://app.hubspot.com/login',
    ['hubspot.com', 'app.hubspot.com'],
  ],
  [
    'zendesk',
    'Zendesk',
    'zendesk',
    'https://www.zendesk.com/login/',
    ['zendesk.com'],
  ],
  [
    'okta',
    'Okta',
    'okta',
    'https://login.okta.com/',
    ['okta.com', 'login.okta.com'],
  ],
  ['auth0', 'Auth0', 'auth0', 'https://manage.auth0.com/login', ['auth0.com']],
  [
    '1password',
    '1Password',
    'onepassword',
    'https://my.1password.com/signin',
    ['1password.com', 'my.1password.com'],
  ],
  [
    'lastpass',
    'LastPass',
    'lastpass',
    'https://lastpass.com/login.php',
    ['lastpass.com'],
  ],
  [
    'bitwarden',
    'Bitwarden',
    'bitwarden',
    'https://vault.bitwarden.com/#/login',
    ['bitwarden.com', 'vault.bitwarden.com'],
  ],
  [
    'proton',
    'Proton',
    'proton',
    'https://account.proton.me/login',
    ['proton.me', 'account.proton.me'],
  ],
  ['icloud', 'iCloud', 'apple', 'https://www.icloud.com/', ['icloud.com']],
  [
    'gmail',
    'Gmail',
    'google',
    'https://accounts.google.com/ServiceLogin?service=mail',
    ['mail.google.com'],
  ],
  [
    'outlook',
    'Outlook',
    'microsoft',
    'https://outlook.live.com/owa/',
    ['outlook.live.com'],
  ],
  [
    'hulu',
    'Hulu',
    'hulu',
    'https://auth.hulu.com/web/login',
    ['hulu.com', 'auth.hulu.com'],
  ],
  [
    'disneyplus',
    'Disney+',
    'disney',
    'https://www.disneyplus.com/login',
    ['disneyplus.com'],
  ],
  [
    'hbomax',
    'Max',
    'max',
    'https://auth.max.com/login',
    ['max.com', 'auth.max.com'],
  ],
  [
    'paramount',
    'Paramount+',
    'paramount',
    'https://www.paramountplus.com/account/signin/',
    ['paramountplus.com'],
  ],
  [
    'primevideo',
    'Prime Video',
    'amazon',
    'https://www.amazon.com/ap/signin',
    ['primevideo.com'],
  ],
  [
    'nytimes',
    'New York Times',
    'nytimes',
    'https://myaccount.nytimes.com/auth/login',
    ['nytimes.com', 'myaccount.nytimes.com'],
  ],
  [
    'bbc',
    'BBC',
    'bbc',
    'https://account.bbc.com/signin',
    ['bbc.com', 'bbc.co.uk', 'account.bbc.com'],
  ],
  [
    'booking',
    'Booking.com',
    'booking',
    'https://account.booking.com/sign-in',
    ['booking.com', 'account.booking.com'],
  ],
  [
    'expedia',
    'Expedia',
    'expedia',
    'https://www.expedia.com/user/login',
    ['expedia.com'],
  ],
  [
    'united',
    'United Airlines',
    'united',
    'https://www.united.com/ual/en/us/account/account/signin',
    ['united.com'],
  ],
  [
    'delta',
    'Delta Air Lines',
    'delta',
    'https://www.delta.com/login/loginPage',
    ['delta.com'],
  ],
  [
    'southwest',
    'Southwest',
    'southwest',
    'https://www.southwest.com/loyalty/login',
    ['southwest.com'],
  ],
  [
    'marriott',
    'Marriott',
    'marriott',
    'https://www.marriott.com/sign-in.mi',
    ['marriott.com'],
  ],
  [
    'hilton',
    'Hilton',
    'hilton',
    'https://www.hilton.com/en/hilton-honors/login/',
    ['hilton.com'],
  ],
]

if (SITES.length !== 100) {
  console.error(`Expected 100 sites, got ${SITES.length}`)
  process.exit(1)
}

function shellFor(id, family) {
  if (SPECIAL[id]) return SPECIAL[id]
  if (SPECIAL[family]) return SPECIAL[family]
  // Banks / financial often username+password
  if (
    [
      'chase',
      'bankofamerica',
      'wellsfargo',
      'citi',
      'capitalone',
      'usbank',
      'americanexpress',
      'discover',
      'schwab',
      'fidelity',
      'vanguard',
      'robinhood',
    ].includes(id)
  ) {
    return usernamePassword({ userName: 'username', passName: 'password' })
  }
  // SSO-style email-first for many SaaS
  if (
    [
      'okta',
      'auth0',
      'salesforce',
      'hubspot',
      'zendesk',
      'asana',
      'notion',
      'figma',
      'canva',
      'shopify',
      'stripe',
      'cloudflare',
      'vercel',
      'netlify',
      'heroku',
      'digitalocean',
      'monday',
      'atlassian',
      'trello',
      'zoom',
      'dropbox',
      'adobe',
      'squarespace',
      'wordpress',
      'bitbucket',
      'gitlab',
      'onepassword',
      'lastpass',
      'bitwarden',
      'proton',
      'coinbase',
      'binance',
      'venmo',
      'cashapp',
    ].includes(id)
  ) {
    return emailFirst()
  }
  // Streaming / shopping / social default: email+password
  return emailPassword()
}

const CAPTURE_IDS = new Set([
  'facebook',
  'google',
  'microsoft',
  'apple',
  'amazon',
  'github',
  'linkedin',
  'x',
  'slack',
  'instagram',
])

const SPECIAL_TEMPLATE_IDS = {
  facebook: 'facebook',
  github: 'github',
  instagram: 'instagram',
  linkedin: 'linkedin',
  slack: 'slack',
  x: 'x',
  microsoft: 'microsoft',
  azure: 'microsoft',
  office: 'microsoft',
  outlook: 'microsoft',
  google: 'google',
  gmail: 'google',
  youtube: 'google',
  apple: 'apple',
  icloud: 'apple',
}

function shapeKey(shell) {
  return JSON.stringify({
    quirks: shell.quirks ?? [],
    steps: shell.steps,
  })
}

function genericTemplateName(shell) {
  const steps = shell.steps ?? []
  const names = (steps[0]?.fields ?? []).map((field) => field.name)
  if (steps.length === 1 && names[0] === 'email' && names[1] === 'password') {
    return 'email-password'
  }
  if (
    steps.length === 1 &&
    names[0] === 'username' &&
    names[1] === 'password'
  ) {
    return 'username-password'
  }
  if (steps.length >= 2 && names[0] === 'email') return 'email-first'
  if (steps.length >= 2 && names[0] === 'loginfmt') return 'microsoft'
  if (steps.length >= 2 && names[0] === 'identifier') return 'google'
  if (steps.length === 1 && names[0] === 'accountName') return 'apple'
  return null
}

const catalog = SITES.map(([id, name, family, loginUrl, hosts], index) => ({
  id,
  name,
  family,
  loginUrl,
  hosts,
  rank: index + 1,
}))

writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)

/** @type {Map<string, { quirks: string[], steps: unknown[] }>} */
const shellsById = new Map()
for (const site of catalog) {
  const shell = shellFor(site.id, site.family)
  shellsById.set(site.id, {
    quirks: shell.quirks ?? [],
    steps: shell.steps,
  })
}

/** @type {Map<string, string>} */
const templateIdByShape = new Map()
/** @type {Map<string, { id: string, quirks: string[], steps: unknown[] }>} */
const templates = new Map()

for (const site of catalog) {
  const shell = shellsById.get(site.id)
  const key = shapeKey(shell)
  if (templateIdByShape.has(key)) continue
  let templateId =
    SPECIAL_TEMPLATE_IDS[site.id] ?? genericTemplateName(shell) ?? site.id
  const existing = templates.get(templateId)
  if (existing && shapeKey(existing) !== key) {
    templateId = `${templateId}-${createHash('sha1').update(key).digest('hex').slice(0, 6)}`
  }
  templateIdByShape.set(key, templateId)
  if (!templates.has(templateId)) {
    templates.set(templateId, {
      id: templateId,
      quirks: shell.quirks,
      steps: shell.steps,
    })
  }
}

rmSync(legacySitesDir, { recursive: true, force: true })
rmSync(templatesDir, { recursive: true, force: true })
mkdirSync(templatesDir, { recursive: true })

for (const [templateId, template] of [...templates.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  writeFileSync(
    path.join(templatesDir, `${templateId}.json`),
    `${JSON.stringify(template, null, 2)}\n`,
  )
}

/** @type {Record<string, { template: string, source: string, loginUrl: string }>} */
const siteShells = {}
for (const site of catalog) {
  const shell = shellsById.get(site.id)
  const template = templateIdByShape.get(shapeKey(shell))
  siteShells[site.id] = {
    template,
    source: CAPTURE_IDS.has(site.id) ? 'capture' : 'research',
    loginUrl: site.loginUrl,
  }
}

writeFileSync(siteShellsPath, `${JSON.stringify(siteShells, null, 2)}\n`)

console.log(`Wrote ${catalog.length} catalog entries → ${catalogPath}`)
console.log(`Wrote ${templates.size} shell templates → ${templatesDir}`)
console.log(`Wrote ${catalog.length} site→template map → ${siteShellsPath}`)
