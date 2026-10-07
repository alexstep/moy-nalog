await Bun.write(
  'dist/index.d.cts',
  "import NalogAPI from './index.js'\nexport = NalogAPI\n",
)
