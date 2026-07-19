const { AndroidConfig, withAndroidManifest, withStringsXml } = require('expo/config-plugins')

module.exports = function withAndroidThorFork(config) {
  config = withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults)
    // Why: Thor can relaunch the upper Activity with the lower display present;
    // allow Android to reconfigure it instead of rejecting the multi-display task.
    activity.$['android:resizeableActivity'] = 'true'

    // Why: Android launches MAIN/LAUNCHER on whichever Thor panel owns the icon tap. A tiny
    // trampoline can safely originate there and always dispatch the real singleTask Activity to
    // display 0, even when an old Orca task already exists.
    activity['intent-filter'] = (activity['intent-filter'] ?? []).filter(
      (filter) =>
        !filter.action?.some((action) => action.$['android:name'] === 'android.intent.action.MAIN')
    )
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    application.activity = (application.activity ?? []).filter(
      (candidate) => candidate.$['android:name'] !== 'expo.modules.thordisplay.ThorLauncherActivity'
    )
    application.activity.push({
      $: {
        'android:name': 'expo.modules.thordisplay.ThorLauncherActivity',
        'android:exported': 'true',
        'android:excludeFromRecents': 'true',
        'android:noHistory': 'true',
        'android:resizeableActivity': 'true',
        'android:theme': '@style/Theme.App.SplashScreen'
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }]
        }
      ]
    })
    return cfg
  })

  return withStringsXml(config, (cfg) => {
    AndroidConfig.Strings.setStringItem(
      [{ $: { name: 'app_name' }, _: 'Orca Thor' }],
      cfg.modResults
    )
    return cfg
  })
}
