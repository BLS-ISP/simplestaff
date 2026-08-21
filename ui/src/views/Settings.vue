<template>
  <cv-grid fullWidth class="settings-page">
    <!-- Header -->
    <cv-row>
      <cv-column class="page-title-col">
        <div class="header-container">
          <div>
            <h2 class="main-title">{{ $t("settings.title") }}</h2>
            <p class="subtitle">{{ $t("settings.page_subtitle") }}</p>
          </div>
        </div>
      </cv-column>
    </cv-row>

    <!-- Error on Get Configuration -->
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

    <!-- Settings Form Area -->
    <cv-row>
      <cv-column class="form-column">
        <cv-form @submit.prevent="configureModule">
          
          <!-- Card 1: Domain & Administrator Settings -->
          <cv-tile light class="settings-card">
            <div class="card-header">
              <div class="card-title-group">
                <Globe20 class="card-icon" />
                <div>
                  <h4 class="card-title">{{ $t("settings.general_section") }}</h4>
                  <span class="card-desc">{{ $t("settings.general_section_desc") }}</span>
                </div>
              </div>
            </div>

            <div class="form-fields">
              <cv-text-input
                :label="$t('settings.domain_name')"
                v-model="domainName"
                :placeholder="$t('settings.domain_name_placeholder')"
                :disabled="loading.getConfiguration || loading.configureModule"
                :invalid-message="error.domainName"
                ref="domainName"
                class="field-item"
              ></cv-text-input>

              <cv-text-input
                :label="$t('settings.super_admin_email')"
                v-model="superAdminEmail"
                :placeholder="$t('settings.super_admin_email_placeholder')"
                :disabled="loading.getConfiguration || loading.configureModule"
                :invalid-message="error.superAdminEmail"
                ref="superAdminEmail"
                class="field-item"
              ></cv-text-input>

              <cv-text-input
                :label="$t('settings.super_admin_password')"
                v-model="superAdminPassword"
                type="password"
                :placeholder="isAlreadyConfigured ? $t('settings.super_admin_password_existing') : $t('settings.super_admin_password_placeholder')"
                :disabled="loading.getConfiguration || loading.configureModule"
                :invalid-message="error.superAdminPassword"
                ref="superAdminPassword"
                class="field-item"
              ></cv-text-input>

              <div class="toggles-grid">
                <div class="toggle-card">
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

                <div class="toggle-card">
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
              </div>
            </div>
          </cv-tile>

          <!-- Card 2: SMTP Email Notifications -->
          <cv-tile light class="settings-card">
            <div class="card-header">
              <div class="card-title-group">
                <Email20 class="card-icon" />
                <div>
                  <h4 class="card-title">{{ $t("settings.smtp_section") }}</h4>
                  <span class="card-desc">{{ $t("settings.smtp_section_desc") }}</span>
                </div>
              </div>
            </div>

            <div class="form-fields">
              <div class="master-toggle-box">
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

              <!-- Collapsible SMTP Fields with Transition -->
              <div v-if="smtpEnabled" class="smtp-expanded-box">
                <div class="fields-row-2">
                  <cv-text-input
                    :label="$t('settings.smtp_host')"
                    v-model="smtpHost"
                    :placeholder="$t('settings.smtp_host_placeholder')"
                    :disabled="loading.getConfiguration || loading.configureModule"
                    :invalid-message="error.smtpHost"
                    ref="smtpHost"
                    class="field-item"
                  ></cv-text-input>

                  <cv-text-input
                    :label="$t('settings.smtp_port')"
                    v-model="smtpPort"
                    type="number"
                    :placeholder="$t('settings.smtp_port_placeholder')"
                    :disabled="loading.getConfiguration || loading.configureModule"
                    :invalid-message="error.smtpPort"
                    ref="smtpPort"
                    class="field-item"
                  ></cv-text-input>
                </div>

                <div class="fields-row-2">
                  <cv-text-input
                    :label="$t('settings.smtp_user')"
                    v-model="smtpUser"
                    :placeholder="$t('settings.smtp_user_placeholder')"
                    :disabled="loading.getConfiguration || loading.configureModule"
                    :invalid-message="error.smtpUser"
                    ref="smtpUser"
                    class="field-item"
                  ></cv-text-input>

                  <cv-text-input
                    :label="$t('settings.smtp_password')"
                    v-model="smtpPassword"
                    type="password"
                    :placeholder="$t('settings.smtp_password_placeholder')"
                    :disabled="loading.getConfiguration || loading.configureModule"
                    :invalid-message="error.smtpPassword"
                    ref="smtpPassword"
                    class="field-item"
                  ></cv-text-input>
                </div>

                <cv-text-input
                  :label="$t('settings.smtp_from')"
                  v-model="smtpFrom"
                  :placeholder="$t('settings.smtp_from_placeholder')"
                  :disabled="loading.getConfiguration || loading.configureModule"
                  :invalid-message="error.smtpFrom"
                  ref="smtpFrom"
                  class="field-item"
                ></cv-text-input>
              </div>
            </div>
          </cv-tile>

          <!-- Error Notification on Save -->
          <div v-if="error.configureModule" class="error-wrapper">
            <NsInlineNotification
              kind="error"
              :title="$t('action.configure-module')"
              :description="error.configureModule"
              :showCloseButton="false"
            />
          </div>

          <!-- Bottom Action Bar -->
          <div class="actions-bar">
            <NsButton
              kind="primary"
              :icon="Save20"
              :loading="loading.configureModule"
              :disabled="loading.getConfiguration || loading.configureModule"
              class="save-btn"
            >
              {{ $t("settings.save") }}
            </NsButton>
          </div>

        </cv-form>
      </cv-column>
    </cv-row>
  </cv-grid>
</template>

<script>
import to from "await-to-js";
import { mapState } from "vuex";
import Globe20 from "@carbon/icons-vue/es/globe/20";
import Email20 from "@carbon/icons-vue/es/email/20";
import Save20 from "@carbon/icons-vue/es/save/20";
import {
  QueryParamService,
  UtilService,
  TaskService,
  IconService,
  PageTitleService,
} from "@nethserver/ns8-ui-lib";

export default {
  name: "Settings",
  components: {
    Globe20,
    Email20,
  },
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
      Save20,
      q: {
        page: "settings",
      },
      urlCheckInterval: null,
      domainName: "",
      superAdminEmail: "",
      superAdminPassword: "",
      letsEncrypt: true,
      http2https: true,
      isAlreadyConfigured: false,
      smtpEnabled: false,
      smtpHost: "",
      smtpPort: "587",
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
      vm.getConfiguration();
    });
  },
  beforeRouteLeave(to, from, next) {
    clearInterval(this.urlCheckInterval);
    next();
  },
  methods: {
    async getConfiguration() {
      this.loading.getConfiguration = true;
      this.error.getConfiguration = "";
      const taskAction = "get-configuration";
      const eventId = this.getUuid();

      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        this.getConfigurationAborted
      );

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
      const config = taskResult.output;
      if (config) {
        this.domainName = config.domain_name || "";
        this.superAdminEmail = config.super_admin_email || "";
        if (config.domain_name) {
          this.isAlreadyConfigured = true;
        }
        if (config.lets_encrypt !== undefined) {
          this.letsEncrypt = Boolean(config.lets_encrypt);
        }
        if (config.http2https !== undefined) {
          this.http2https = Boolean(config.http2https);
        }
        if (config.smtp_enabled !== undefined) {
          this.smtpEnabled = Boolean(config.smtp_enabled);
        }
        this.smtpHost = config.smtp_host || "";
        this.smtpPort = String(config.smtp_port || "587");
        this.smtpUser = config.smtp_user || "";
        this.smtpFrom = config.smtp_from || "";
      }
      this.loading.getConfiguration = false;
    },
    validate() {
      let isValidationOk = true;

      // Reset errors
      this.error.domainName = "";
      this.error.superAdminEmail = "";
      this.error.superAdminPassword = "";
      this.error.smtpHost = "";
      this.error.smtpPort = "";

      if (!this.domainName.trim()) {
        this.error.domainName = this.$t("common.required");
        isValidationOk = false;
      }

      if (!this.superAdminEmail.trim()) {
        this.error.superAdminEmail = this.$t("common.required");
        isValidationOk = false;
      }

      if (!this.isAlreadyConfigured && !this.superAdminPassword.trim()) {
        this.error.superAdminPassword = this.$t("common.required");
        isValidationOk = false;
      }

      if (this.superAdminPassword.trim() && this.superAdminPassword.length < 6) {
        this.error.superAdminPassword = this.$t("settings.super_admin_password_placeholder");
        isValidationOk = false;
      }

      if (this.smtpEnabled) {
        if (!this.smtpHost.trim()) {
          this.error.smtpHost = this.$t("common.required");
          isValidationOk = false;
        }
        if (!this.smtpPort.trim()) {
          this.error.smtpPort = this.$t("common.required");
          isValidationOk = false;
        }
      }

      return isValidationOk;
    },
    async configureModule() {
      if (!this.validate()) {
        return;
      }

      this.loading.configureModule = true;
      this.error.configureModule = "";
      const taskAction = "configure-module";
      const eventId = this.getUuid();

      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        this.configureModuleAborted
      );

      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        this.configureModuleCompleted
      );

      const payload = {
        domain_name: this.domainName.trim(),
        super_admin_email: this.superAdminEmail.trim(),
        lets_encrypt: Boolean(this.letsEncrypt),
        http2https: Boolean(this.http2https),
        smtp_enabled: Boolean(this.smtpEnabled),
        smtp_host: this.smtpHost.trim(),
        smtp_port: parseInt(this.smtpPort, 10) || 587,
        smtp_user: this.smtpUser.trim(),
        smtp_password: this.smtpPassword,
        smtp_from: this.smtpFrom.trim(),
      };

      if (this.superAdminPassword.trim()) {
        payload.super_admin_password = this.superAdminPassword.trim();
      }

      const res = await to(
        this.createModuleTaskForApp(this.instanceName, {
          action: taskAction,
          data: payload,
          extra: {
            title: this.$t("action." + taskAction),
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

      this.createSuccessNotificationForApp(
        this.$t("settings.saved_successfully")
      );

      this.getConfiguration();
    },
  },
};
</script>

<style scoped lang="scss">
@import "../styles/carbon-utils";

.settings-page {
  padding-bottom: $spacing-09;
}

.page-title-col {
  margin-bottom: $spacing-06;
}

.header-container {
  display: flex;
  align-items: center;
  justify-content: space-between;

  .main-title {
    font-size: 1.75rem;
    font-weight: 600;
    color: $text-01;
    margin: 0;
  }

  .subtitle {
    font-size: 0.875rem;
    color: $text-02;
    margin-top: $spacing-02;
  }
}

.form-column {
  max-width: 54rem; // 864px max width for optimal readability
}

.settings-card {
  border-radius: 6px;
  border: 1px solid $ui-03;
  margin-bottom: $spacing-06;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  padding: $spacing-06;
}

.card-header {
  border-bottom: 1px solid $ui-03;
  padding-bottom: $spacing-04;
  margin-bottom: $spacing-05;

  .card-title-group {
    display: flex;
    align-items: center;
    gap: $spacing-04;

    .card-icon {
      fill: #0f62fe;
      flex-shrink: 0;
    }

    .card-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: $text-01;
      margin: 0;
    }

    .card-desc {
      font-size: 0.8125rem;
      color: $text-02;
    }
  }
}

.form-fields {
  display: flex;
  flex-direction: column;
  gap: $spacing-05;
}

.field-item {
  width: 100%;
}

.fields-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: $spacing-05;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.toggles-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: $spacing-05;
  margin-top: $spacing-02;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.toggle-card {
  background-color: $ui-01;
  border: 1px solid $ui-03;
  border-radius: 4px;
  padding: $spacing-04;
}

.master-toggle-box {
  background-color: $ui-01;
  border: 1px solid $ui-03;
  border-radius: 4px;
  padding: $spacing-04;
}

.toggle-helper {
  font-size: 0.75rem;
  color: $text-05;
  margin-top: $spacing-02;
}

.smtp-expanded-box {
  background-color: $ui-01;
  border: 1px solid $ui-03;
  border-radius: 4px;
  padding: $spacing-05;
  display: flex;
  flex-direction: column;
  gap: $spacing-05;
  margin-top: $spacing-02;
}

.error-wrapper {
  margin-bottom: $spacing-05;
}

.actions-bar {
  display: flex;
  align-items: center;
  padding-top: $spacing-03;

  .save-btn {
    min-width: 12rem;
    height: 3rem;
  }
}
</style>
