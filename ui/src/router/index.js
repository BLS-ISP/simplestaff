import Vue from "vue";
import VueRouter from "vue-router";
import Status from "../views/Status.vue";
import Settings from "../views/Settings.vue";

import About from "../views/About.vue";

Vue.use(VueRouter);

const routes = [
  {
    path: "/status",
    name: "Status",
    component: Status,
  },
  {
    path: "/",
    redirect: "/status",
  },
  {
    path: "/settings",
    name: "Settings",
    component: Settings,
  },
  {
    path: "/about",
    name: "About",
    component: About,
  },
];

const router = new VueRouter({
  base: process.env.BASE_URL,
  routes,
});

export default router;
