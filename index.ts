import { Kernel } from './src/kernel'
import { pluginManager } from './src/pluginmgr'
import { getPlugins } from './src/config'
const kernel = new Kernel()
async function main() {
  const config = await kernel.boot('./config.json')
  pluginManager.initKernelAPI()
  pluginManager.setServer(kernel.getServer())
  const plugins = getPlugins()
  for (const pluginConfig of plugins) {
    await pluginManager.loadPlugin(pluginConfig);
    await pluginManager.activate(pluginConfig.name)
  }
  try {
    const { getDBConfigValue } = await import('./src/config')
    const port = getDBConfigValue('server.port', 3000)
    await kernel.start(port)
  } catch {
    await kernel.start()
  }
}
main().catch(console.error)
process.on('SIGINT', async () => {
  console.log('收到关闭信号，正在优雅关闭...')
  await kernel.stop()
  process.exit(0)
})
process.on('SIGTERM', async () => {
  console.log('收到关闭信号，正在优雅关闭...')
  await kernel.stop()
  process.exit(0)
})
export { Kernel }
export type { Plugin } from './src/types'
export { pluginManager } from './src/pluginmgr'
export { hookManager } from './src/hookmgr'
export { privManager } from './src/privmgr'
export { loadConfig, getConfig, getDBConfig, getDBConfigValue, setDBConfig, getPlugins } from './src/config'