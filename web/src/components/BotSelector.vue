<template>
  <div class="bot-selector">
    <div class="selector-header">
      <span>{{ $t("ask.selectBots", { max }) }}</span>
      <el-tag :type="selected.length >= max ? 'danger' : 'info'" size="small">
        {{ $t("ask.selected", { count: selected.length, max }) }}
      </el-tag>
    </div>
    <el-collapse v-model="activeGroups">
      <el-collapse-item
        v-for="group in groups"
        :key="group.key"
        :title="`${$t(`ask.groups.${group.key}`)} (${group.bots.length})`"
        :name="group.key"
      >
        <div class="bot-grid">
          <el-tooltip
            v-for="bot in group.bots"
            :key="bot.id"
            :disabled="bot.configured"
            :content="$t('credentials.unavailable')"
            placement="top"
          >
            <el-checkbox
              :model-value="selected.includes(bot.id)"
              :label="bot.id"
              :disabled="!bot.configured"
              @change="(val) => toggle(bot.id, val)"
            >
              {{ bot.name }}
            </el-checkbox>
          </el-tooltip>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";

const props = defineProps({
  bots: { type: Array, required: true }, // with .tags, .configured
  selected: { type: Array, required: true },
  max: { type: Number, default: 5 },
});
const emit = defineEmits(["update:selected"]);
const { t } = useI18n();

const GROUP_ORDER = ["free", "paid", "api", "madeInChina"];
const activeGroups = ref(["free", "api", "madeInChina"]);

const groups = computed(() =>
  GROUP_ORDER.map((key) => ({
    key,
    bots: props.bots.filter((b) => (b.tags || []).includes(key)),
  })).filter((g) => g.bots.length)
);

function toggle(botId, checked) {
  let next;
  if (checked) {
    if (props.selected.length >= props.max) {
      ElMessage.warning(t("ask.tooManyBots", { max: props.max }));
      return;
    }
    next = [...props.selected, botId];
  } else {
    next = props.selected.filter((id) => id !== botId);
  }
  emit("update:selected", next);
}
</script>

<style scoped>
.selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.bot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px 12px;
}
</style>
