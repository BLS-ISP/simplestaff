export async function loadLanguage(lang) {
  let messages;
  try {
    messages = await import(
      /* webpackChunkName: "lang-[request]" */ `../../public/i18n/${lang}/translation.json`
    );
  } catch (error) {
    console.warn(`Cannot load language '${lang}', falling back to 'en'`);
    messages = await import(
      /* webpackChunkName: "lang-en" */ `../../public/i18n/en/translation.json`
    );
  }
  return messages;
}
