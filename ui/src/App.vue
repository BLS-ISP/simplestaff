<template>
  <div id="ns8-app">
    <cv-content id="main-content" class="app-content">
      <AppSideMenu />
      <AppMobileSideMenu />
      <router-view />
    </cv-content>
  </div>
</template>

<script>
import AppSideMenu from "./components/AppSideMenu";
import AppMobileSideMenu from "./components/AppMobileSideMenu";
import { mapState, mapActions } from "vuex";
import {
  QueryParamService,
  TaskService,
  UtilService,
} from "@nethserver/ns8-ui-lib";
import to from "await-to-js";

export default {
  name: "App",
  components: { AppSideMenu, AppMobileSideMenu },
  mixins: [QueryParamService, TaskService, UtilService],
  computed: {
    ...mapState(["instanceName", "instanceLabel", "core"]),
  },
  created() {
    try {
      const core = window.parent.core;
      if (!core) {
        console.error("SimpleStaff: window.parent.core is not available");
        return;
      }
      this.setCoreInStore(core);

      // Safely extract instance name from parent URL hash
      const hashMatch = /#\/apps\/([a-zA-Z0-9_-]+)/.exec(
        window.parent.location.hash
      );
      if (!hashMatch || !hashMatch[1]) {
        console.error("SimpleStaff: could not extract instance name from URL hash:", window.parent.location.hash);
        return;
      }
      const instanceName = hashMatch[1];
      this.setInstanceNameInStore(instanceName);
      this.getInstanceLabel();
      this.setAppName();

      // listen to change route events
      const context = this;
      window.addEventListener(
        "changeRoute",
        function (e) {
          try {
            const requestedPage = e.detail;
            if (!requestedPage) return;
            const allowedRoutes = ["/", "/status", "/settings", "/about"];
            const cleanPath = "/" + requestedPage.replace(/^\/+|\/+$/g, '').split('?')[0];
            if (allowedRoutes.includes(cleanPath)) {
              context.$router.replace(requestedPage).catch(err => {
                if (err && err.name !== "NavigationDuplicated") {
                  console.warn("SimpleStaff router.replace failed:", err);
                }
              });
            } else {
              console.log("SimpleStaff: ignoring non-app changeRoute path:", requestedPage);
            }
          } catch (err) {
            console.error("SimpleStaff error in changeRoute listener:", err);
          }
        },
        false
      );

      // Detect if parent URL hash leaves our app and clean up sync intervals to prevent freezes
      setInterval(() => {
        try {
          const parentHash = window.parent.location.hash;
          const appPrefix = "/apps/" + this.instanceName;
          if (parentHash.indexOf(appPrefix) === -1) {
            if (this.$route && this.$route.matched) {
              this.$route.matched.forEach(route => {
                if (route.instances && route.instances.default) {
                  const vm = route.instances.default;
                  if (vm.urlCheckInterval) {
                    clearInterval(vm.urlCheckInterval);
                    vm.urlCheckInterval = null;
                    console.log("SimpleStaff: Cleared urlCheckInterval because parent navigated away to", parentHash);
                  }
                }
              });
            }
          }
        } catch (e) {
          // ignore
        }
      }, 250);

      // configure global shortcuts
      if (core.$root) {
        core.$root.$emit("configureKeyboardShortcuts", window);
      }

      const queryParams = this.getQueryParamsForApp();
      const requestedPage = queryParams.page || "status";

      if (requestedPage != "status") {
        this.$router.replace(requestedPage);
      }
    } catch (e) {
      console.error("SimpleStaff: error during app initialization:", e);
    }
  },
  methods: {
    ...mapActions([
      "setInstanceNameInStore",
      "setInstanceLabelInStore",
      "setCoreInStore",
      "setAppNameInStore",
    ]),
    async getInstanceLabel() {
      const taskAction = "get-name";
      const eventId = this.getUuid();

      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        this.getInstanceLabelAborted
      );

      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        this.getInstanceLabelCompleted
      );

      const res = await to(
        this.createModuleTaskForApp(this.instanceName, {
          action: taskAction,
          extra: {
            title: this.$t("action." + taskAction),
            isNotificationHidden: true,
            eventId,
          },
        })
      );
      const err = res[0];

      if (err) {
        console.error(`error creating task ${taskAction}`, err);
        this.createErrorNotificationForApp(
          err,
          this.$t("task.cannot_create_task", { action: taskAction })
        );
        return;
      }
    },
    getInstanceLabelAborted(taskResult, taskContext) {
      console.error(`${taskContext.action} aborted`, taskResult);
    },
    getInstanceLabelCompleted(taskContext, taskResult) {
      this.setInstanceLabelInStore(taskResult.output.name);
    },
    setAppName() {
      const metadata = require("../public/metadata.json");
      const appName = metadata.name;
      this.setAppNameInStore(appName);
    },
  },
};
</script>

<style lang="scss">
@import "styles/carbon-utils";
</style>
