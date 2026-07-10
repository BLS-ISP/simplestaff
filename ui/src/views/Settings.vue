<template>
  <cv-grid fullWidth>
    <cv-row>
      <cv-column class="page-title">
        <h2>{{ $t("settings.title") }}</h2>
      </cv-column>
    </cv-row>
    <cv-row v-if="error.getConfiguration">
      <cv-column>
        <NsInlineNotification
          kind="error"
          :title="$t('action.get-configuration')"
          :description="error.getConfiguration"
          :showCloseButton="false"
        />
      </cv-column>
    </cv-row>
    <cv-row>
      <cv-column>
        <cv-tile light>
          <cv-form @submit.prevent="configureModule">
            <cv-text-input
              :label="$t('settings.domain_name')"
              v-model="domainName"
              :placeholder="$t('settings.domain_name_placeholder')"
              :disabled="loading.getConfiguration || loading.configureModule"
              :invalid-message="error.domainName"
              ref="domainName"
            ></cv-text-input>
            <cv-text-input
              :label="$t('settings.super_admin_email')"
              v-model="superAdminEmail"
              :placeholder="$t('settings.super_admin_email_placeholder')"
              :disabled="loading.getConfiguration || loading.configureModule"
              :invalid-message="error.superAdminEmail"
              ref="superAdminEmail"
            ></cv-text-input>
            <cv-text-input
              :label="$t('settings.super_admin_password')"
              v-model="superAdminPassword"
              type="password"
              :placeholder="$t('settings.super_admin_password_placeholder')"
              :disabled="loading.getConfiguration || loading.configureModule"
              :invalid-message="error.superAdminPassword"
              ref="superAdminPassword"
            ></cv-text-input>
            <cv-row v-if="error.configureModule">
              <cv-column>
                <NsInlineNotification
                  kind="error"
                  :title="$t('action.configure-module')"
                  :description="error.configureModule"
                  :showCloseButton="false"
                />
              </cv-column>
            </cv-row>
            <NsButton
              kind="primary"
              :icon="Save20"
              :loading="loading.configureModule"
              :disabled="loading.getConfiguration || loading.configureModule"
              >{{ $t("settings.save") }}</NsButton
            >
          </cv-form>
        </cv-tile>
      </cv-column>
    </cv-row>
  </cv-grid>
</template>

<script>
import to from "await-to-js";
import { mapState } from "vuex";
import {
  QueryParamService,
  UtilService,
  TaskService,
  IconService,
  PageTitleService,
} from "@nethserver/ns8-ui-lib";

export default {
  name: "Settings",
  mixins: [
    TaskService,
    IconService,
    UtilService,
    QueryParamService,
    PageTitleService,
  ],
  pageTitle() {
    return this.$t("settings.title") + " - " + this.appName;
  },
  data() {
    return {
      q: {
        page: "settings",
      },
      urlCheckInterval: null,
      domainName: "",
      superAdminEmail: "",
      superAdminPassword: "",
      loading: {
        getConfiguration: false,
        configureModule: false,
      },
      error: {
        getConfiguration: "",
        configureModule: "",
        domainName: "",
        superAdminEmail: "",
        superAdminPassword: "",
      },
    };
  },
  computed: {
    ...mapState(["instanceName", "core", "appName"]),
  },
  beforeRouteEnter(to, from, next) {
    next((vm) => {
      vm.watchQueryData(vm);
      vm.urlCheckInterval = vm.initUrlBindingForApp(vm, vm.q.page);
    });
  },
  beforeRouteLeave(to, from, next) {
    clearInterval(this.urlCheckInterval);
    next();
  },
  created() {
    this.getConfiguration();
  },
  methods: {
    async getConfiguration() {
      this.loading.getConfiguration = true;
      this.error.getConfiguration = "";
      const taskAction = "get-configuration";
      const eventId = this.getUuid();

      // register to task error
      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        this.getConfigurationAborted
      );

      // register to task completion
      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        this.getConfigurationCompleted
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
        this.error.getConfiguration = this.getErrorMessage(err);
        this.loading.getConfiguration = false;
        return;
      }
    },
    getConfigurationAborted(taskResult, taskContext) {
      console.error(`${taskContext.action} aborted`, taskResult);
      this.error.getConfiguration = this.$t("error.generic_error");
      this.loading.getConfiguration = false;
    },
    getConfigurationCompleted(taskContext, taskResult) {
      this.loading.getConfiguration = false;
      const config = taskResult.output;

      this.domainName = config.domain_name || "";
      this.superAdminEmail = config.super_admin_email || "";
      // password is intentionally not loaded back

      this.focusElement("domainName");
    },
    validateConfigureModule() {
      this.clearErrors(this);
      let isValidationOk = true;

      if (!this.domainName) {
        this.error.domainName = this.$t("common.required");
        if (isValidationOk) {
          this.focusElement("domainName");
          isValidationOk = false;
        }
      }

      if (!this.superAdminEmail) {
        this.error.superAdminEmail = this.$t("common.required");
        if (isValidationOk) {
          this.focusElement("superAdminEmail");
          isValidationOk = false;
        }
      }

      if (!this.superAdminPassword) {
        this.error.superAdminPassword = this.$t("common.required");
        if (isValidationOk) {
          this.focusElement("superAdminPassword");
          isValidationOk = false;
        }
      }

      return isValidationOk;
    },
    configureModuleValidationFailed(validationErrors) {
      this.loading.configureModule = false;
      let focusAlreadySet = false;

      for (const validationError of validationErrors) {
        const field = validationError.field;

        // map JSON schema field names to Vue data field names
        const fieldMap = {
          domain_name: "domainName",
          super_admin_email: "superAdminEmail",
          super_admin_password: "superAdminPassword",
        };

        const vueField = fieldMap[field] || field;

        if (vueField !== "(root)") {
          this.error[vueField] = this.$t(
            "settings." + validationError.error
          );

          if (!focusAlreadySet) {
            this.focusElement(vueField);
            focusAlreadySet = true;
          }
        }
      }
    },
    async configureModule() {
      const isValidationOk = this.validateConfigureModule();
      if (!isValidationOk) {
        return;
      }

      this.loading.configureModule = true;
      const taskAction = "configure-module";
      const eventId = this.getUuid();

      // register to task error
      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        this.configureModuleAborted
      );

      // register to task validation
      this.core.$root.$once(
        `${taskAction}-validation-failed-${eventId}`,
        this.configureModuleValidationFailed
      );

      // register to task completion
      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        this.configureModuleCompleted
      );

      const res = await to(
        this.createModuleTaskForApp(this.instanceName, {
          action: taskAction,
          data: {
            domain_name: this.domainName,
            super_admin_email: this.superAdminEmail,
            super_admin_password: this.superAdminPassword,
          },
          extra: {
            title: this.$t("settings.configure_instance", {
              instance: this.instanceName,
            }),
            description: this.$t("common.processing"),
            eventId,
          },
        })
      );
      const err = res[0];

      if (err) {
        console.error(`error creating task ${taskAction}`, err);
        this.error.configureModule = this.getErrorMessage(err);
        this.loading.configureModule = false;
        return;
      }
    },
    configureModuleAborted(taskResult, taskContext) {
      console.error(`${taskContext.action} aborted`, taskResult);
      this.error.configureModule = this.$t("error.generic_error");
      this.loading.configureModule = false;
    },
    configureModuleCompleted() {
      this.loading.configureModule = false;

      // reload configuration
      this.getConfiguration();
    },
  },
};
</script>

<style scoped lang="scss">
@import "../styles/carbon-utils";
</style>
