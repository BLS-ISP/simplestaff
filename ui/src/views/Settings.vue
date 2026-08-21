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
            <!-- General Settings Section -->
            <div class="section-title">
              <h4>{{ $t("settings.general_section") }}</h4>
            </div>

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
              :placeholder="isAlreadyConfigured ? $t('settings.super_admin_password_existing') : $t('settings.super_admin_password_placeholder')"
              :disabled="loading.getConfiguration || loading.configureModule"
              :invalid-message="error.superAdminPassword"
              ref="superAdminPassword"
            ></cv-text-input>

            <div class="toggle-section">
              <cv-toggle
                :label="$t('settings.lets_encrypt')"
                v-model="letsEncrypt"
                :disabled="loading.getConfiguration || loading.configureModule"
                value="letsEncryptToggle"
              >
                <template slot="text-left">{{ $t("settings.disabled") }}</template>
                <template slot="text-right">{{ $t("settings.enabled") }}</template>
              </cv-toggle>
              <div class="toggle-helper">{{ $t("settings.lets_encrypt_helper") }}</div>
            </div>

            <div class="toggle-section">
              <cv-toggle
                :label="$t('settings.http2https')"
                v-model="http2https"
                :disabled="loading.getConfiguration || loading.configureModule"
                value="http2httpsToggle"
              >
                <template slot="text-left">{{ $t("settings.disabled") }}</template>
                <template slot="text-right">{{ $t("settings.enabled") }}</template>
              </cv-toggle>
              <div class="toggle-helper">{{ $t("settings.http2https_helper") }}</div>
            </div>

            <!-- SMTP Email Section -->
            <div class="section-divider"></div>
            <div class="section-title">
              <h4>{{ $t("settings.smtp_section") }}</h4>
            </div>

            <div class="toggle-section">
              <cv-toggle
                :label="$t('settings.smtp_enabled')"
                v-model="smtpEnabled"
                :disabled="loading.getConfiguration || loading.configureModule"
                value="smtpEnabledToggle"
              >
                <template slot="text-left">{{ $t("settings.disabled") }}</template>
                <template slot="text-right">{{ $t("settings.enabled") }}</template>
              </cv-toggle>
              <div class="toggle-helper">{{ $t("settings.smtp_enabled_helper") }}</div>
            </div>

            <div v-if="smtpEnabled" class="smtp-fields">
              <cv-text-input
                :label="$t('settings.smtp_host')"
                v-model="smtpHost"
                :placeholder="$t('settings.smtp_host_placeholder')"
                :disabled="loading.getConfiguration || loading.configureModule"
                :invalid-message="error.smtpHost"
                ref="smtpHost"
              ></cv-text-input>

              <cv-text-input
                :label="$t('settings.smtp_port')"
                v-model="smtpPort"
                type="number"
                :placeholder="$t('settings.smtp_port_placeholder')"
                :disabled="loading.getConfiguration || loading.configureModule"
                :invalid-message="error.smtpPort"
                ref="smtpPort"
              ></cv-text-input>

              <cv-text-input
                :label="$t('settings.smtp_user')"
                v-model="smtpUser"
                :placeholder="$t('settings.smtp_user_placeholder')"
                :disabled="loading.getConfiguration || loading.configureModule"
                :invalid-message="error.smtpUser"
                ref="smtpUser"
              ></cv-text-input>

              <cv-text-input
                :label="$t('settings.smtp_password')"
                v-model="smtpPassword"
                type="password"
                :placeholder="$t('settings.smtp_password_placeholder')"
                :disabled="loading.getConfiguration || loading.configureModule"
                :invalid-message="error.smtpPassword"
                ref="smtpPassword"
              ></cv-text-input>

              <cv-text-input
                :label="$t('settings.smtp_from')"
                v-model="smtpFrom"
                :placeholder="$t('settings.smtp_from_placeholder')"
                :disabled="loading.getConfiguration || loading.configureModule"
                :invalid-message="error.smtpFrom"
                ref="smtpFrom"
              ></cv-text-input>
            </div>

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
      isAlreadyConfigured: false,
      domainName: "",
      superAdminEmail: "",
      superAdminPassword: "",
      letsEncrypt: true,
      http2https: true,
      smtpEnabled: false,
      smtpHost: "",
      smtpPort: 587,
      smtpUser: "",
      smtpPassword: "",
      smtpFrom: "",
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
        smtpHost: "",
        smtpPort: "",
        smtpUser: "",
        smtpPassword: "",
        smtpFrom: "",
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
      const config = taskResult.output || {};

      this.domainName = config.domain_name || "";
      this.superAdminEmail = config.super_admin_email || "";
      this.isAlreadyConfigured = Boolean(config.domain_name);

      // Load SSL settings (default to true if not set)
      this.letsEncrypt = config.lets_encrypt !== undefined ? config.lets_encrypt : true;
      this.http2https = config.http2https !== undefined ? config.http2https : true;

      // Load SMTP settings
      this.smtpEnabled = config.smtp_enabled !== undefined ? config.smtp_enabled : false;
      this.smtpHost = config.smtp_host || "";
      this.smtpPort = config.smtp_port || 587;
      this.smtpUser = config.smtp_user || "";
      this.smtpFrom = config.smtp_from || "";

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

      // Super admin password required on initial setup
      if (!this.isAlreadyConfigured && !this.superAdminPassword) {
        this.error.superAdminPassword = this.$t("common.required");
        if (isValidationOk) {
          this.focusElement("superAdminPassword");
          isValidationOk = false;
        }
      }

      if (this.superAdminPassword && this.superAdminPassword.length < 6) {
        this.error.superAdminPassword = this.$t("settings.super_admin_password_placeholder");
        if (isValidationOk) {
          this.focusElement("superAdminPassword");
          isValidationOk = false;
        }
      }

      if (this.smtpEnabled && !this.smtpHost) {
        this.error.smtpHost = this.$t("common.required");
        if (isValidationOk) {
          this.focusElement("smtpHost");
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
          smtp_enabled: "smtpEnabled",
          smtp_host: "smtpHost",
          smtp_port: "smtpPort",
          smtp_user: "smtpUser",
          smtp_password: "smtpPassword",
          smtp_from: "smtpFrom",
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

      const payload = {
        domain_name: this.domainName,
        super_admin_email: this.superAdminEmail,
        lets_encrypt: this.letsEncrypt,
        http2https: this.http2https,
        smtp_enabled: this.smtpEnabled,
        smtp_host: this.smtpHost,
        smtp_port: parseInt(this.smtpPort) || 587,
        smtp_user: this.smtpUser,
        smtp_from: this.smtpFrom,
      };

      if (this.superAdminPassword && this.superAdminPassword.trim().length > 0) {
        payload.super_admin_password = this.superAdminPassword.trim();
      }

      if (this.smtpPassword && this.smtpPassword.trim().length > 0) {
        payload.smtp_password = this.smtpPassword.trim();
      }

      const res = await to(
        this.createModuleTaskForApp(this.instanceName, {
          action: taskAction,
          data: payload,
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
      this.superAdminPassword = "";
      this.smtpPassword = "";

      // reload configuration
      this.getConfiguration();
    },
  },
};
</script>

<style scoped lang="scss">
@import "../styles/carbon-utils";

.section-title {
  margin-top: $spacing-05;
  margin-bottom: $spacing-04;

  h4 {
    color: $text-01;
    font-weight: 600;
  }
}

.section-divider {
  height: 1px;
  background-color: $ui-03;
  margin: $spacing-07 0 $spacing-05 0;
}

.toggle-section {
  margin-bottom: $spacing-05;
}

.toggle-helper {
  font-size: 0.75rem;
  color: $text-05;
  margin-top: $spacing-02;
}

.smtp-fields {
  background-color: $ui-01;
  padding: $spacing-05;
  border-radius: 4px;
  border: 1px solid $ui-03;
  margin-bottom: $spacing-06;
}
</style>
