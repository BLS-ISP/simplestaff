import Vue from "vue";
import VueRouter from "vue-router";
import Status from "../views/Status.vue";
import Settings from "../views/Settings.vue";

Vue.use(VueRouter);

const routes = [
  {
    path: "/",
    name: "Status",
    component: Status,
    alias: "/status",
  },
  {
    path: "/settings",
    name: "Settings",
    component: Settings,
  },
  {
    path: "/about",
    name: "About",
    component: () =>
      import(/* webpackChunkName: "about" */ "../views/About.vue"),
  },
];

const router = new VueRouter({
  base: process.env.BASE_URL,
  routes,
});

export default router;
