// background.js — handles alarm-based tab refresh + notifications

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith("refresh-")) return;
  const tabId = parseInt(alarm.name.replace("refresh-", ""));
  chrome.tabs.reload(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_REFRESH") {
    const alarmName = `refresh-${msg.tabId}`;
    chrome.alarms.clear(alarmName, () => {
      chrome.alarms.create(alarmName, {
        delayInMinutes: msg.intervalSeconds / 60,
        periodInMinutes: msg.intervalSeconds / 60
      });
    });
    sendResponse({ ok: true });
  }

  if (msg.type === "STOP_REFRESH") {
    chrome.alarms.clear(`refresh-${msg.tabId}`);
    sendResponse({ ok: true });
  }

  if (msg.type === "GET_TAB_ID") {
    sendResponse({ tabId: sender.tab && sender.tab.id });
    return true;
  }

  if (msg.type === "GET_ALARM") {
    chrome.alarms.get(`refresh-${msg.tabId}`, (alarm) => {
      sendResponse({ active: !!alarm });
    });
    return true;
  }

  if (msg.type === "NOTIFY") {
    chrome.notifications.create(`sf-notify-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon48.png",
      title: msg.title,
      message: msg.message,
      priority: 2
    });
  }
});
