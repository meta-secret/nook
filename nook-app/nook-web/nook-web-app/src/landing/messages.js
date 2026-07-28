export const landingMessages = {
  en: {
    'meta.title': 'Nook — Keys, not accounts',
    'meta.description':
      'Nook is an open-source, client-side password and secrets manager for encrypted vaults that stay under your control.',
    'language.label': 'Page language',
    'theme.switch_dark': 'Switch to dark mode',
    'theme.switch_light': 'Switch to light mode',
    'nav.label': 'Public pages',
    'nav.open_app': 'Open app',
    'nav.open_nook': 'Open Nook',
    'nav.open_simple': 'Simple Vault',
    'nav.open_sentinel': 'Sentinel Vault',
    'nav.architecture': 'Architecture',
    'nav.cryptography': 'Cryptography',
    'nav.privacy': 'Privacy',
    'nav.terms': 'Terms',
    'nav.source': 'Source',
    'github.short': 'GitHub',
    'github.link_label': 'View Nook on GitHub',
    'github.stars_label': 'GitHub stars',
    'hero.eyebrow': 'Vault 01 / personal secret system',
    'hero.title': 'Keys,<br />not accounts.',
    'hero.lead':
      'Nook is a passwordless, local first, decentralized secrets manager. Your vault is encrypted before it leaves the browser, replicated only through storage you choose, and opened only by identities you authorize.',
    'hero.open_nook': 'Open Nook',
    'hero.open_simple': 'Open Simple Vault',
    'hero.open_sentinel': 'Open Sentinel Vault',
    'extension.hero_link': 'Get the browser extension',
    'extension.footer_link': 'Browser extension',
    'extension.eyebrow': 'Simple Vault companion / browser extension',
    'extension.title': 'Fill passwords where you work.',
    'extension.description':
      'Add Nook to Chrome or Brave for permissioned password filling. The extension is a separately protected device that pairs only with Simple Vault; Sentinel Vault never participates.',
    'extension.loading': 'Loading extension channel…',
    'extension.unavailable':
      'Extension installation is unavailable for this deployment.',
    'extension.channel': 'Channel',
    'extension.version': 'Version',
    'extension.add_store': 'Add to Chrome',
    'extension.download_zip': 'Download extension ZIP',
    'extension.store_note':
      'Production installs and updates through the Chrome Web Store. Brave can install the same listing.',
    'extension.manual_title': 'Install this preview manually',
    'extension.manual_download':
      'Download and unzip the channel-specific archive.',
    'extension.manual_extensions':
      'Open <code>chrome://extensions</code> in Chrome or Brave and enable Developer mode.',
    'extension.manual_load':
      'Choose Load unpacked and select the extracted folder.',
    'capsule.label':
      'Encrypted Nook vault capsule protected by a device identity and immutable event log',
    'capsule.principles_label': 'Nook principles',
    'architecture.eyebrow': 'Architecture manifest / 04 layers',
    'architecture.title': 'A vault architecture with no central keeper.',
    'architecture.identity_detail':
      'Each authorized device holds its own protected X25519 identity. Plaintext identity material exists only inside an unlocked session.',
    'architecture.keys_detail':
      'Vault keys are wrapped into per-device cryptographic envelopes, so authorized identities can unlock secrets without central authority service.',
    'architecture.sync_detail':
      'Optional providers transport encrypted vault events. They see ciphertext and storage operations—not the secrets held inside.',
    'architecture.log_detail':
      'Encrypted changes converge through a content-addressed event history, preserving the order and integrity of your vault.',
    'inventory.title': 'For those who read the protocol.',
    'inventory.grid_label': 'Nook cryptographic primitives',
    'inventory.implemented': 'Implemented in Rust',
    'crypto.slip0039':
      'Nook splits a 256-bit Sentinel root into current-format, single-group SLIP-0039 mnemonic shares with checksums and recovery metadata.',
    'crypto.shamir':
      'The threshold foundation: divide secret material into distinct shares so only a valid quorum can reconstruct it.',
    'crypto.threshold':
      'A configurable T-of-N policy accepts any T distinct compatible shares from the enrolled N participants.',
    'crypto.hkdf':
      'Domain-separated HKDF-SHA256 expands existing secret material into independent keys for a specific Nook purpose.',
    'crypto.webauthn':
      'A user-verifying passkey ceremony produces PRF output in the browser; Nook consumes it in Rust and never persists the output.',
    'crypto.passkey_identity':
      'Nook derives a deterministic age X25519 device identity from WebAuthn PRF output and the credential user handle.',
    'crypto.x25519':
      'Each device public key receives its own encrypted vault-key or recovery-share envelope; only the matching identity can open it.',
    'crypto.ed25519':
      'Ed25519 signs canonical vault-event bodies so peers can verify who authorized each immutable event.',
    'crypto.aes':
      'AES-256-GCM protects local device-identity records while detecting ciphertext or authenticated-metadata modification.',
    'crypto.pbkdf2':
      'The PIN fallback derives its local wrapping key with PBKDF2-SHA256 and stores the versioned parameters beside authenticated ciphertext.',
    'crypto.scrypt':
      'Password access is represented by age scrypt envelopes that wrap high-entropy vault keys instead of encrypting every record directly.',
    'crypto.epochs':
      'Password rotation, password removal, and device revocation start new cryptographic epochs for future private event payloads.',
    'crypto.zeroize':
      'Sensitive roots, shares, PRF output, private identities, vault keys, and tokens are explicitly cleared when their Rust-owned lifetime ends.',
    'crypto.aead':
      'Authenticated associated data binds local envelopes to their format version and derivation parameters, not only to their ciphertext.',
    'crypto.sha256':
      'An event ID is the base64url SHA-256 digest of its canonical body, making immutable provider paths content-addressed.',
    'crypto.dag':
      'Signed event parents form a causal DAG that lets replicas verify history, detect concurrency, and converge without a central sequencer.',
    'crypto.age':
      'Nook uses the age format for X25519 recipient envelopes and scrypt-protected ciphertext while keeping the cryptographic operations in Rust.',
  },
  ru: {
    'meta.title': 'Nook — Ключи, не аккаунты',
    'meta.description':
      'Nook — open-source клиентский менеджер паролей и секретов: зашифрованный vault остаётся под вашим контролем.',
    'language.label': 'Язык страницы',
    'theme.switch_dark': 'Включить тёмную тему',
    'theme.switch_light': 'Включить светлую тему',
    'nav.label': 'Публичные страницы',
    'nav.open_app': 'Открыть Nook',
    'nav.open_nook': 'Открыть Nook',
    'nav.open_simple': 'Простой сейф',
    'nav.open_sentinel': 'Сейф Sentinel',
    'nav.architecture': 'Архитектура',
    'nav.cryptography': 'Криптография',
    'nav.privacy': 'Конфиденциальность',
    'nav.terms': 'Условия',
    'nav.source': 'Исходный код',
    'github.short': 'GitHub',
    'github.link_label': 'Открыть Nook на GitHub',
    'github.stars_label': 'Звёзды на GitHub',
    'hero.eyebrow': 'Vault 01 / система личных секретов',
    'hero.title': 'Ключи,<br />не аккаунты.',
    'hero.lead':
      'Nook — passwordless, local-first, децентрализованный менеджер секретов. Ваш vault шифруется ещё в браузере, реплицируется только через выбранное вами хранилище и открывается лишь identities, которым вы дали доступ.',
    'hero.open_nook': 'Открыть Nook',
    'hero.open_simple': 'Открыть простой сейф',
    'hero.open_sentinel': 'Открыть сейф Sentinel',
    'extension.hero_link': 'Установить расширение для браузера',
    'extension.footer_link': 'Расширение для браузера',
    'extension.eyebrow': 'Компаньон Simple Vault / расширение браузера',
    'extension.title': 'Заполняйте пароли там, где работаете.',
    'extension.description':
      'Добавьте Nook в Chrome или Brave для разрешённого заполнения паролей. Расширение — это отдельно защищённое устройство, которое подключается только к Simple Vault; Sentinel Vault не участвует.',
    'extension.loading': 'Загрузка канала расширения…',
    'extension.unavailable':
      'Установка расширения недоступна для этого deployment.',
    'extension.channel': 'Канал',
    'extension.version': 'Версия',
    'extension.add_store': 'Добавить в Chrome',
    'extension.download_zip': 'Скачать ZIP расширения',
    'extension.store_note':
      'Production-версия устанавливается и обновляется через Chrome Web Store. В Brave используется та же страница.',
    'extension.manual_title': 'Установить эту preview-версию вручную',
    'extension.manual_download':
      'Скачайте и распакуйте архив для текущего канала.',
    'extension.manual_extensions':
      'Откройте <code>chrome://extensions</code> в Chrome или Brave и включите режим разработчика.',
    'extension.manual_load':
      'Нажмите «Загрузить распакованное расширение» и выберите распакованную папку.',
    'capsule.label':
      'Зашифрованная капсула Nook, защищённая device identity и immutable event log',
    'capsule.principles_label': 'Принципы Nook',
    'architecture.eyebrow': 'Манифест архитектуры / 04 слоя',
    'architecture.title': 'Архитектура vault без центрального хранителя.',
    'architecture.identity_detail':
      'Каждое авторизованное устройство хранит собственную защищённую X25519 identity. Identity material существует в plaintext только внутри разблокированной сессии.',
    'architecture.keys_detail':
      'Vault keys обёрнуты в отдельные cryptographic envelopes для каждого устройства, поэтому авторизованные identities открывают секреты без central authority service.',
    'architecture.sync_detail':
      'Опциональные providers переносят зашифрованные vault events. Они видят ciphertext и операции хранилища, но не секреты внутри.',
    'architecture.log_detail':
      'Зашифрованные изменения сходятся в content-addressed event history, сохраняя порядок и целостность вашего vault.',
    'inventory.title': 'Для тех, кто читает протокол.',
    'inventory.grid_label': 'Криптографические primitives Nook',
    'inventory.implemented': 'Реализовано на Rust',
    'crypto.slip0039':
      'Nook разделяет 256-битный Sentinel root на SLIP-0039 mnemonic shares актуального формата: одна группа, checksums и recovery metadata.',
    'crypto.shamir':
      'Shamir Secret Sharing лежит в основе threshold-схемы: секрет делится на отдельные shares, и восстановить его может только допустимый quorum.',
    'crypto.threshold':
      'Настраиваемая T-of-N policy принимает любые T разных совместимых shares от N зарегистрированных участников.',
    'crypto.hkdf':
      'Domain-separated HKDF-SHA256 разворачивает существующий secret material в независимые keys для конкретной задачи Nook.',
    'crypto.webauthn':
      'Passkey ceremony с user verification выдаёт WebAuthn PRF output в браузере; Nook обрабатывает его в Rust и никогда не сохраняет.',
    'crypto.passkey_identity':
      'Nook детерминированно выводит age X25519 device identity из WebAuthn PRF output и credential user handle.',
    'crypto.x25519':
      'Каждый device public key получает собственный зашифрованный vault-key или recovery-share envelope; открыть его может только соответствующая identity.',
    'crypto.ed25519':
      'Ed25519 подписывает canonical vault-event bodies, чтобы peers могли проверить автора каждого immutable event.',
    'crypto.aes':
      'AES-256-GCM защищает локальные device-identity records и обнаруживает изменение ciphertext или authenticated metadata.',
    'crypto.pbkdf2':
      'PIN fallback выводит локальный wrapping key через PBKDF2-SHA256 и хранит versioned parameters рядом с authenticated ciphertext.',
    'crypto.scrypt':
      'Password access представлен age scrypt envelopes, которые оборачивают high-entropy vault keys вместо прямого шифрования каждой записи.',
    'crypto.epochs':
      'Смена или удаление пароля и отзыв устройства начинают новые cryptographic key epochs для будущих private event payloads.',
    'crypto.zeroize':
      'Sensitive roots, shares, PRF output, private identities, vault keys и tokens явно обнуляются по завершении их lifetime, контролируемого Rust.',
    'crypto.aead':
      'Authenticated associated data привязывает локальные envelopes к version и derivation parameters, а не только к ciphertext.',
    'crypto.sha256':
      'Event ID — это base64url SHA-256 digest canonical body, благодаря чему immutable provider paths становятся content-addressed.',
    'crypto.dag':
      'Подписанные event parents образуют causal DAG: replicas проверяют историю, обнаруживают concurrency и сходятся без central sequencer.',
    'crypto.age':
      'Nook использует формат age для X25519 recipient envelopes и scrypt-protected ciphertext, сохраняя cryptographic operations внутри Rust.',
  },
}
