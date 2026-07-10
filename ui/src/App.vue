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

      // Extract instance name from parent URL — support both hash-based and
      // history-based routing used by different NS8 core versions.
      let instanceName = "";
      try {
        // Try hash-based routing first (standard NS8 pattern)
        const hashMatch = /#\/apps\/(\w+)/.exec(window.parent.location.hash);
        if (hashMatch && hashMatch[1]) {
          instanceName = hashMatch[1];
        }
      } catch (_e) {
        // ignore
      }

      if (!instanceName) {
        // Fall back to path-based routing
        const pathMatch = /\/apps\/([a-zA-Z0-9_-]+)/.exec(
          window.parent.location.href
        );
        if (pathMatch && pathMatch[1]) {
          instanceName = pathMatch[1];
        }
      }

      if (!instanceName) {
        console.error(
          "SimpleStaff: could not extract instance name from parent URL:",
          window.parent.location.href
        );
        return;
      }

      this.setInstanceNameInStore(instanceName);
      this.getInstanceLabel();
      this.setAppName();

      // Listen to changeRoute events from the NS8 core
      const context = this;
      window.addEventListener(
        "changeRoute",
        function (e) {
          try {
            const requestedPage = e.detail;
            if (!requestedPage) return;
            context.$router.replace(requestedPage).catch((err) => {
              if (err && err.name !== "NavigationDuplicated") {
                console.warn("SimpleStaff router.replace failed:", err);
              }
            });
          } catch (err) {
            console.error("SimpleStaff error in changeRoute listener:", err);
          }
        },
        false
      );

      // Configure global shortcuts
      if (core.$root) {
        core.$root.$emit("configureKeyboardShortcuts", window);
      }

      const queryParams = this.getQueryParamsForApp();
      const requestedPage = queryParams.page || "status";
      const allowedPages = ["status", "settings", "about"];

      if (allowedPages.includes(requestedPage)) {
        this.$router.replace("/" + requestedPage).catch(() => {});
      } else {
        this.$router.replace("/status").catch(() => {});
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
