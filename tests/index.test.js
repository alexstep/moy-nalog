const NalogAPI = require('../index.js')

if (!process.env.USERPASS) {
  process.exit(1)
}

const [USER, PASS] = process.env.USERPASS.split(':')

const tests = {
  'Логин и пароль - обязательны при autologin': async () => {
    try {
      // eslint-disable-next-line no-unused-vars
      const ok = new NalogAPI({ password: PASS })
    } catch (err) {
      return true
    }
  },

  'Проверка авто-логина': async () => {
    const MyNalog = new NalogAPI({ login: USER, password: PASS })
    const profile = await MyNalog.userInfo().catch(err => {
      console.error('autologin error', err)
      throw err
    })

    if (!profile || !profile.id) {
      console.error(profile)
      throw new Error('Ошибка получения информации о пользователе')
    }
    return true
  },

  'Самостоятельный логин': async () => {
    const MyNalog = new NalogAPI({ autologin: false })
    if (MyNalog.authPromise) { throw new Error('сработал автологин') }
    const resp = await MyNalog.auth(USER, PASS)
    if (!resp || !resp.refreshToken) {
      console.error(resp)
      throw new Error('Ошибка логина')
    }
    return true
  }
};

(async () => {
  for (const testName in tests) {
    const result = await tests[testName]()
    if (result) {
      console.info(`[OK] - ${testName}`)
    } else {
      console.error(`[FAIL] - ${testName}`, result)
      process.exit(1)
    }
  }
})()
