/**
 * @format
 */

// crypto.getRandomValues for Remote Access keys (pure-JS crypto). Must load first.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
