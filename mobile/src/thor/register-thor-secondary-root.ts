import { AppRegistry } from 'react-native'
import { THOR_SECONDARY_COMPONENT_NAME, ThorSecondaryRoot } from './ThorSecondaryRoot'

// Expo Router registers `main`; the Thor Presentation starts this second app
// key only after the route tree (and therefore this module) has loaded.
if (!AppRegistry.getAppKeys().includes(THOR_SECONDARY_COMPONENT_NAME)) {
  AppRegistry.registerComponent(THOR_SECONDARY_COMPONENT_NAME, () => ThorSecondaryRoot)
}
