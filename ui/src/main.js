import Vue from "vue";
import App from "./App.vue";
import router from "./router";
import store from "./store";

import CarbonComponentsVue from "@carbon/vue";
Vue.use(CarbonComponentsVue);

import axios from "axios";
axios.defaults.timeout = 10000;
import VueAxios from "vue-axios";
Vue.use(VueAxios, axios);

import ns8Lib from "@nethserver/ns8-ui-lib";
Vue.use(ns8Lib);

import VueDateFns from "vue-date-fns";
Vue.use(VueDateFns);

import LottieAnimation from "lottie-web-vue";
Vue.use(LottieAnimation);

import vueDebounce from "vue-debounce";
Vue.use(vueDebounce);

// filters
import { Filters } from "@nethserver/ns8-ui-lib";
for (const f in Filters) {
  Vue.filter(f, Filters[f]);
}

Vue.config.productionTip = false;

// Global error handler: prevent uncaught Vue errors from crashing the NS8 admin panel
Vue.config.errorHandler = function (err, vm, info) {
  console.error("SimpleStaff Vue error:", err, info);
};

// Global unhandled promise rejection handler
window.addEventListener("unhandledrejection", function (event) {
  console.error("SimpleStaff unhandled promise rejection:", event.reason);
  event.preventDefault();
});

// i18n
import VueI18n from "vue-i18n";
import deMessages from "../public/i18n/de/translation.json";
import enMessages from "../public/i18n/en/translation.json";

Vue.use(VueI18n);

const navigatorLang = navigator.language.substring(0, 2);
const activeLang = ["de", "en"].includes(navigatorLang) ? navigatorLang : "en";
const messages = activeLang === "de" ? deMessages : enMessages;

const i18n = new VueI18n({
  locale: activeLang,
  fallbackLocale: "en",
  messages: {
    [activeLang]: messages,
  },
});

new Vue({
  router,
  store,
  i18n,
  render: (h) => h(App),
}).$mount("#ns8-app");
