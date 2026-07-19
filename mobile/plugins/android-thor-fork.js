const { AndroidConfig, withAndroidManifest, withStringsXml } = require('expo/config-plugins')

module.exports = function withAndroidThorFork(config) {
  config = withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults)
    // Why: Thor can relaunch the upper Activity with the lower display present;
    // allow Android to reconfigure it instead of rejecting the multi-display task.
    activity.$['android:resizeableActivity'] = 'true'
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
