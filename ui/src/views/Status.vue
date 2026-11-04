<!--
  SimpleStaff - NethServer 8 Status View
  Professional Carbon Design Dashboard
-->
<template>
  <cv-grid fullWidth class="status-page">
    <!-- Hero Banner -->
    <cv-row>
      <cv-column>
        <cv-tile light class="hero-banner">
          <div class="hero-content">
            <div class="hero-left">
              <div class="hero-logo-box">
                <Application32 class="hero-fallback-icon" />
              </div>
              <div class="hero-details">
                <div class="hero-title-row">
                  <h2 class="hero-title">
                    {{ instanceLabel || "SimpleStaff" }}
                  </h2>
                  <span class="hero-badge">NS8 Module</span>
                  <span
                    class="status-pill"
                    :class="isOverallActive ? 'active' : 'inactive'"
                  >
                    <span class="status-dot"></span>
                    {{
                      isOverallActive
                        ? $t("status.running")
                        : $t("status.stopped")
                    }}
                  </span>
                </div>
                <p class="hero-subtitle">
                  {{ $t("status.hero_description") }}
                </p>
              </div>
            </div>
            <div class="hero-actions">
              <cv-button
                v-if="configuration.app_url"
                kind="primary"
                :icon="Launch20"
                @click="openAppUrl"
                class="hero-btn"
              >
                {{ $t("status.open_app") }}
              </cv-button>
              <cv-button
                v-else
                kind="primary"
                :icon="ArrowRight20"
                @click="goToAppPage(instanceName, 'settings')"
                class="hero-btn"
              >
                {{ $t("status.configure") }}
              </cv-button>
            </div>
          </div>
        </cv-tile>
      </cv-column>
    </cv-row>

    <!-- Error Notifications -->
    <cv-row v-if="error.getStatus">
      <cv-column>
        <NsInlineNotification
          kind="error"
          :title="$t('action.get-status')"
          :description="error.getStatus"
          :showCloseButton="false"
        />
      </cv-column>
    </cv-row>

    <!-- Metric KPI Cards (4 columns) -->
    <cv-row class="kpi-row">
      <!-- Domain Card -->
      <cv-column :sm="4" :md="4" :lg="4">
        <NsInfoCard
          light
          :title="configuration.domain_name || $t('status.not_configured')"
          :description="$t('status.domain')"
          :icon="Globe32"
          :loading="loading.getConfiguration"
          class="metric-card"
        >
          <template slot="content" v-if="configuration.app_url">
            <span class="card-link" @click="openAppUrl">
              {{ configuration.app_url }} <Launch20 class="small-icon" />
            </span>
          </template>
        </NsInfoCard>
      </cv-column>

      <!-- SSL Card -->
      <cv-column :sm="4" :md="4" :lg="4">
        <NsInfoCard
          light
          :title="
            configuration.lets_encrypt
              ? $t('status.ssl_active')
              : $t('status.ssl_inactive')
          "
          :description="$t('status.ssl_certificate')"
          :icon="Locked32"
          :loading="loading.getConfiguration"
          class="metric-card"
        />
      </cv-column>

      <!-- Instance Card -->
      <cv-column :sm="4" :md="4" :lg="4">
        <NsInfoCard
          light
          :title="instanceName || '-'"
          :description="$t('status.app_instance')"
          :icon="Application32"
          :loading="loading.getStatus"
          class="metric-card"
        />
      </cv-column>

      <!-- Node Card -->
      <cv-column :sm="4" :md="4" :lg="4">
        <NsInfoCard
          light
          :title="installationNodeTitle"
          :description="$t('status.installation_node')"
          :icon="Chip32"
          :loading="loading.getStatus"
          class="metric-card"
        />
      </cv-column>
    </cv-row>

    <!-- Quick Utilities Row (Backups & Logs) -->
    <cv-row class="utils-row">
      <!-- Backup Status Card -->
      <cv-column :sm="4" :md="4" :lg="8">
        <NsInfoCard
          light
          :title="$t('status.backup_title')"
          :description="$t('status.backup_desc')"
          :icon="Save32"
          class="util-card"
        >
          <template slot="content">
            <div class="card-inner-details">
              <span class="backup-status-text">
                {{ backupStatusLabel }}
              </span>
              <NsButton
                kind="ghost"
                :icon="ArrowRight20"
                @click="goToBackupPage"
                class="ghost-action"
              >
                {{ $t("status.view_backups") }}
              </NsButton>
            </div>
          </template>
        </NsInfoCard>
      </cv-column>

      <!-- Logs Card -->
      <cv-column :sm="4" :md="4" :lg="8">
        <NsInfoCard
          light
          :title="$t('status.logs_title')"
          :description="$t('status.logs_desc')"
          :icon="Events32"
          class="util-card"
        >
          <template slot="content">
            <div class="card-inner-details">
              <span class="logs-hint-text">
                {{
                  $t("status.logs_instance_hint", { instance: instanceName })
                }}
              </span>
              <NsButton
                kind="ghost"
                :icon="ArrowRight20"
                @click="goToLogsPage"
                class="ghost-action"
              >
                {{ $t("status.view_logs") }}
              </NsButton>
            </div>
          </template>
        </NsInfoCard>
      </cv-column>
    </cv-row>

    <!-- Services & Containers Table -->
    <cv-row class="section-row">
      <cv-column>
        <div class="section-header">
          <h4 class="section-heading">{{ $tc("status.services", 2) }}</h4>
          <span class="section-subheading">{{
            $t("status.services_desc")
          }}</span>
        </div>

        <cv-tile light class="table-card">
          <div v-if="!loading.getStatus">
            <NsEmptyState
              v-if="!status.services.length"
              :title="$t('status.no_services')"
            />
            <cv-structured-list v-else class="status-list">
              <template slot="headings">
                <cv-structured-list-heading>{{
                  $t("status.name")
                }}</cv-structured-list-heading>
                <cv-structured-list-heading>{{
                  $t("status.status")
                }}</cv-structured-list-heading>
              </template>
              <template slot="items">
                <cv-structured-list-item
                  v-for="(service, index) in status.services"
                  :key="index"
                >
                  <cv-structured-list-data class="name-cell font-mono">
                    {{ service.name }}
                  </cv-structured-list-data>
                  <cv-structured-list-data>
                    <span
                      class="service-pill"
                      :class="
                        service.active
                          ? 'active'
                          : service.failed
                          ? 'failed'
                          : 'inactive'
                      "
                    >
                      <span class="service-dot"></span>
                      {{
                        service.status ||
                        (service.active
                          ? $t("status.running")
                          : service.failed
                          ? "failed"
                          : $t("status.stopped"))
                      }}
                    </span>
                  </cv-structured-list-data>
                </cv-structured-list-item>
              </template>
            </cv-structured-list>
          </div>
          <cv-skeleton-text
            v-else
            :paragraph="true"
            :line-count="4"
          ></cv-skeleton-text>
        </cv-tile>
      </cv-column>
    </cv-row>

    <!-- Container Images Table -->
    <cv-row class="section-row">
      <cv-column>
        <div class="section-header">
          <h4 class="section-heading">{{ $tc("status.app_images", 2) }}</h4>
          <span class="section-subheading">{{ $t("status.images_desc") }}</span>
        </div>

        <cv-tile light class="table-card">
          <div v-if="!loading.getStatus">
            <NsEmptyState
              v-if="!status.images.length"
              :title="$t('status.no_images')"
            />
            <cv-structured-list v-else class="status-list">
              <template slot="headings">
                <cv-structured-list-heading>{{
                  $t("status.name")
                }}</cv-structured-list-heading>
                <cv-structured-list-heading>{{
                  $t("status.size")
                }}</cv-structured-list-heading>
                <cv-structured-list-heading>{{
                  $t("status.created")
                }}</cv-structured-list-heading>
              </template>
              <template slot="items">
                <cv-structured-list-item
                  v-for="(image, index) in status.images"
                  :key="index"
                >
                  <cv-structured-list-data
                    class="name-cell font-mono break-word"
                  >
                    {{ image.name }}
                  </cv-structured-list-data>
                  <cv-structured-list-data class="size-cell">
                    {{
                      typeof image.size === "number"
                        ? $options.filters.byteFormat(image.size)
                        : image.size
                    }}
                  </cv-structured-list-data>
                  <cv-structured-list-data class="date-cell">
                    {{ image.created }}
                  </cv-structured-list-data>
                </cv-structured-list-item>
              </template>
            </cv-structured-list>
          </div>
          <cv-skeleton-text
            v-else
            :paragraph="true"
            :line-count="3"
          ></cv-skeleton-text>
        </cv-tile>
      </cv-column>
    </cv-row>

    <!-- App Volumes Table -->
    <cv-row class="section-row">
      <cv-column>
        <div class="section-header">
          <h4 class="section-heading">{{ $tc("status.app_volumes", 2) }}</h4>
          <span class="section-subheading">{{
            $t("status.volumes_desc")
          }}</span>
        </div>

        <cv-tile light class="table-card">
          <div v-if="!loading.getStatus">
            <NsEmptyState
              v-if="!status.volumes.length"
              :title="$t('status.no_volumes')"
            />
            <cv-structured-list v-else class="status-list">
              <template slot="headings">
                <cv-structured-list-heading>{{
                  $t("status.name")
                }}</cv-structured-list-heading>
                <cv-structured-list-heading>{{
                  $t("status.mount")
                }}</cv-structured-list-heading>
                <cv-structured-list-heading>{{
                  $t("status.created")
                }}</cv-structured-list-heading>
              </template>
              <template slot="items">
                <cv-structured-list-item
                  v-for="(volume, index) in status.volumes"
                  :key="index"
                >
                  <cv-structured-list-data class="name-cell font-mono">
                    {{ volume.name }}
                  </cv-structured-list-data>
                  <cv-structured-list-data
                    class="mount-cell font-mono break-word"
                  >
                    {{ volume.mount }}
                  </cv-structured-list-data>
                  <cv-structured-list-data class="size-cell">
                    {{ volume.created }}
                  </cv-structured-list-data>
                </cv-structured-list-item>
              </template>
            </cv-structured-list>
          </div>
          <cv-skeleton-text
            v-else
            :paragraph="true"
            :line-count="2"
          ></cv-skeleton-text>
        </cv-tile>
      </cv-column>
    </cv-row>
  </cv-grid>
</template>

<script>
import to from "await-to-js";
import { mapState } from "vuex";
import Launch20 from "@carbon/icons-vue/es/launch/20";
import ArrowRight20 from "@carbon/icons-vue/es/arrow--right/20";
import Globe32 from "@carbon/icons-vue/es/globe/32";
import Locked32 from "@carbon/icons-vue/es/locked/32";
import Application32 from "@carbon/icons-vue/es/application/32";
import Chip32 from "@carbon/icons-vue/es/chip/32";
import Save32 from "@carbon/icons-vue/es/save/32";
import Events32 from "@carbon/icons-vue/es/events/32";
import {
  QueryParamService,
  UtilService,
  TaskService,
  IconService,
  PageTitleService,
} from "@nethserver/ns8-ui-lib";

export default {
  name: "Status",
  components: {
    Application32,
    Launch20,
  },
  mixins: [
    TaskService,
    IconService,
    UtilService,
    QueryParamService,
    PageTitleService,
  ],
  pageTitle() {
    return this.$t("status.title") + " - " + this.appName;
  },
  data() {
    return {
      Launch20,
      ArrowRight20,
      Globe32,
      Locked32,
      Application32,
      Chip32,
      Save32,
      Events32,
      q: {
        page: "status",
      },
      hasLogo: false,
      urlCheckInterval: null,
      status: {
        instance: "",
        node: "1",
        node_ui_name: "Knoten 1",
        services: [],
        images: [],
        volumes: [],
      },
      configuration: {
        domain_name: "",
        app_url: "",
        lets_encrypt: false,
      },
      loading: {
        getStatus: false,
        getConfiguration: false,
      },
      error: {
        getStatus: "",
        getConfiguration: "",
      },
    };
  },
  computed: {
    ...mapState(["instanceName", "instanceLabel", "core", "appName"]),
    isOverallActive() {
      if (!this.status.services || this.status.services.length === 0) {
        return false;
      }
      return this.status.services.every((s) => s.active);
    },
    installationNodeTitle() {
      if (this.status && this.status.node_ui_name) {
        return this.status.node_ui_name;
      } else if (this.status && this.status.node) {
        return this.$t("status.node") + " " + this.status.node;
      }
      return "Knoten 1";
    },
    backupStatusLabel() {
      return this.$t("status.backup_status_active");
    },
  },
  created() {
    this.getStatus();
    this.getConfiguration();
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
  methods: {
    async getStatus() {
      this.loading.getStatus = true;
      this.error.getStatus = "";
      const taskAction = "get-status";
      const eventId = this.getUuid();

      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        this.getStatusAborted
      );

      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        this.getStatusCompleted
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
        this.error.getStatus = this.getErrorMessage(err);
        this.loading.getStatus = false;
        return;
      }
    },
    getStatusAborted(taskResult, taskContext) {
      console.error(`${taskContext.action} aborted`, taskResult);
      this.error.getStatus = this.$t("error.generic_error");
      this.loading.getStatus = false;
    },
    getStatusCompleted(taskContext, taskResult) {
      const output = taskResult.output;
      if (output) {
        this.status = {
          instance: output.instance || this.instanceName,
          node: output.node || "1",
          node_ui_name: output.node_ui_name || `Knoten ${output.node || "1"}`,
          services: output.services || [],
          images: output.images || [],
          volumes: output.volumes || [],
        };
      }
      this.loading.getStatus = false;
    },
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
        this.configuration = {
          domain_name: config.domain_name || "",
          app_url:
            config.app_url ||
            (config.domain_name ? `https://${config.domain_name}` : ""),
          lets_encrypt: Boolean(config.lets_encrypt),
        };
      }
      this.loading.getConfiguration = false;
    },
    openAppUrl() {
      if (this.configuration.app_url) {
        window.open(this.configuration.app_url, "_blank");
      }
    },
    goToBackupPage() {
      if (this.core && this.core.$router) {
        this.core.$router.push("/settings/backup");
      }
    },
    goToLogsPage() {
      if (this.core && this.core.$router) {
        this.core.$router.push(`/logs/modules/${this.instanceName}`);
      }
    },
  },
};
</script>

<style scoped lang="scss">
@import "../styles/carbon-utils";

.status-page {
  padding-bottom: $spacing-09;
}

// Hero Banner
.hero-banner {
  border-radius: 6px;
  border: 1px solid $ui-03;
  padding: $spacing-06;
  margin-bottom: $spacing-06;
  background: linear-gradient(135deg, #ffffff 0%, #f4f7fb 100%);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}

.hero-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-05;
  flex-wrap: wrap;
}

.hero-left {
  display: flex;
  align-items: center;
  gap: $spacing-05;
}

.hero-logo-box {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  background-color: #0f62fe;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;

  .hero-fallback-icon {
    fill: #ffffff;
  }
}

.hero-title-row {
  display: flex;
  align-items: center;
  gap: $spacing-04;
  flex-wrap: wrap;

  .hero-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: $text-01;
    margin: 0;
  }

  .hero-badge {
    background-color: $ui-03;
    color: $text-01;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 12px;
  }
}

.hero-subtitle {
  font-size: 0.875rem;
  color: $text-02;
  margin-top: $spacing-02;
}

.hero-btn {
  height: 3rem;
  min-width: 11rem;
}

// Status Pills
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  &.active {
    background-color: #defbe6;
    color: #0e6027;

    .status-dot {
      background-color: #198038;
    }
  }

  &.inactive {
    background-color: #f4f4f4;
    color: #525252;

    .status-dot {
      background-color: #8d8d8d;
    }
  }
}

// Service Status Pill
.service-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;

  .service-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  &.active {
    background-color: #defbe6;
    color: #0e6027;

    .service-dot {
      background-color: #198038;
    }
  }

  &.inactive {
    background-color: #f4f4f4;
    color: #525252;

    .service-dot {
      background-color: #8d8d8d;
    }
  }

  &.failed {
    background-color: #ffebee;
    color: #c62828;

    .service-dot {
      background-color: #da1e28;
    }
  }
}

.kpi-row {
  margin-bottom: $spacing-06;
}

.metric-card {
  border-radius: 6px;
  border: 1px solid $ui-03;
  min-height: 7.5rem;
}

.card-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: #0f62fe;
  cursor: pointer;
  margin-top: $spacing-02;

  &:hover {
    text-decoration: underline;
  }

  .small-icon {
    width: 14px;
    height: 14px;
  }
}

.utils-row {
  margin-bottom: $spacing-06;
}

.util-card {
  border-radius: 6px;
  border: 1px solid $ui-03;
}

.card-inner-details {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: $spacing-03;
  font-size: 0.8125rem;
  color: $text-02;
}

.section-row {
  margin-bottom: $spacing-06;
}

.section-header {
  margin-bottom: $spacing-03;

  .section-heading {
    font-size: 1.125rem;
    font-weight: 600;
    color: $text-01;
    margin: 0;
  }

  .section-subheading {
    font-size: 0.8125rem;
    color: $text-02;
  }
}

.table-card {
  border-radius: 6px;
  border: 1px solid $ui-03;
  padding: 0;
  overflow: hidden;
}

.status-list {
  margin: 0;
}

.font-mono {
  font-family: monospace, monospace;
  font-size: 0.8125rem;
}

.name-cell {
  color: $text-01;
  font-weight: 500;
}

.size-cell {
  color: $text-02;
  width: 8rem;
}

.date-cell {
  color: $text-02;
  width: 10rem;
}

.mount-cell {
  color: $text-02;
}

.break-word {
  word-break: break-all;
}
</style>
