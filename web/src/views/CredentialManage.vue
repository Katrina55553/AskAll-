<template>
  <div>
    <el-card>
      <template #header>
        <div class="header">
          <h3>{{ $t("credentials.title") }}</h3>
          <el-input
            v-model="keyword"
            :placeholder="$t('common.loading') === '' ? '' : '搜索 / Search'"
            clearable
            style="width: 240px"
          />
        </div>
      </template>

      <el-collapse v-model="activeGroups">
        <el-collapse-item
          v-for="group in groups"
          :key="group.key"
          :title="`${$t(`ask.groups.${group.key}`)} (${group.bots.length})`"
          :name="group.key"
        >
          <div
            v-for="bot in group.bots"
            :key="bot.id"
            class="cred-row"
          >
            <div class="cred-info">
              <span class="bot-name">{{ bot.name }}</span>
              <el-tag size="small" :type="bot.configured ? 'success' : 'info'">
                {{
                  bot.configured
                    ? $t("credentials.available")
                    : $t("credentials.unavailable")
                }}
              </el-tag>
              <el-tag size="small" effect="plain">
                {{
                  bot.credentialType === "cookie"
                    ? $t("credentials.cookie")
                    : $t("credentials.apiKey")
                }}
              </el-tag>
            </div>
            <div class="cred-actions">
              <el-input
                v-model="inputs[bot.id]"
                :placeholder="
                  bot.credentialType === 'cookie'
                    ? $t('credentials.cookie')
                    : $t('credentials.apiKey')
                "
                :type="visible[bot.id] ? 'text' : 'password'"
                style="width: 320px"
                clearable
              >
                <template #append>
                  <el-button @click="visible[bot.id] = !visible[bot.id]">
                    <el-icon><View v-if="!visible[bot.id]" /><Hide v-else /></el-icon>
                  </el-button>
                </template>
              </el-input>
              <el-button
                type="primary"
                :disabled="!inputs[bot.id]"
                @click="save(bot)"
              >
                {{ $t("credentials.save") }}
              </el-button>
              <el-button
                :disabled="!bot.configured"
                :loading="validating[bot.id]"
                @click="validate(bot)"
              >
                {{ $t("credentials.validate") }}
              </el-button>
              <el-button
                type="danger"
                :disabled="!bot.configured"
                @click="clear(bot)"
              >
                {{ $t("credentials.clear") }}
              </el-button>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { View, Hide } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import api from "../api";

const { t } = useI18n();
const bots = ref([]);
const inputs = reactive({});
const visible = reactive({});
const validating = reactive({});
const keyword = ref("");
const activeGroups = ref(["api", "madeInChina", "free", "paid"]);

const GROUP_ORDER = ["free", "paid", "api", "madeInChina"];

const groups = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return GROUP_ORDER.map((key) => ({
    key,
    bots: bots.value.filter(
      (b) =>
        (b.tags || []).includes(key) &&
        (!kw || b.name.toLowerCase().includes(kw) || b.id.includes(kw))
    ),
  })).filter((g) => g.bots.length);
});

async function load() {
  const [{ data: botsData }, { data: credData }] = await Promise.all([
    api.get("/bots"),
    api.get("/credentials"),
  ]);
  const statusMap = {};
  for (const c of credData.credentials) statusMap[c.id] = c.configured;
  bots.value = botsData.bots.map((b) => ({
    ...b,
    configured: !!statusMap[b.id],
  }));
}

onMounted(load);

async function save(bot) {
  await api.put(`/credentials/${bot.id}`, { value: inputs[bot.id] });
  inputs[bot.id] = "";
  ElMessage.success(t("credentials.saveSuccess"));
  await load();
}

async function validate(bot) {
  validating[bot.id] = true;
  try {
    const { data } = await api.post(`/credentials/${bot.id}/validate`);
    if (data.ok) ElMessage.success(t("credentials.validateSuccess"));
    else
      ElMessage.error(
        `${t("credentials.validateFailed")}${data.error ? "：" + data.error : ""}`
      );
  } catch (e) {
    ElMessage.error(e.response?.data?.error || e.message);
  } finally {
    validating[bot.id] = false;
  }
}

async function clear(bot) {
  await ElMessageBox.confirm(t("history.deleteConfirm"), "", {
    confirmButtonText: t("common.confirm"),
    cancelButtonText: t("common.cancel"),
  });
  await api.delete(`/credentials/${bot.id}`);
  ElMessage.success(t("credentials.clearSuccess"));
  await load();
}
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header h3 {
  margin: 0;
}
.cred-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #ebeef5;
  flex-wrap: wrap;
  gap: 8px;
}
.cred-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
}
.bot-name {
  font-size: 14px;
}
.cred-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
