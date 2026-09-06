import { tempConfig, FakeBrowser, sample } from './helpers.js';
import { XService } from '../dist/service.js';
import { ArtifactStore } from '../dist/store.js';
import { startDashboard } from '../dist/dashboard.js';
const environment=await tempConfig();environment.config.delayMs=1250;environment.config.enableWrites=false;
class FixtureBrowser extends FakeBrowser {
  override async open(){this.state='logged_in';return this.status();}
  override async close(){this.state='closed';}
}
const browser=new FixtureBrowser();browser.state='closed';browser.account='fixture_user';
browser.result=sample([{id:'12345',text:'A synthetic post about public research. <script>window.compromised=true</script>',url:'https://x.com/fixture_user/status/12345'}]);
const store=new ArtifactStore(environment.config.dataDir);
await store.saveSnapshot(sample([{id:'1',text:'An earlier browser-test observation.',url:'https://x.com/alice/status/1'}]),'Sample collection');
const service=new XService(browser,store,environment.config);
const server=await startDashboard(service,{port:8794,env:{}});
console.log('Synthetic dashboard fixture at '+server.url);
const close=async()=>{await server.close();await environment.cleanup();process.exit(0);};process.once('SIGTERM',close);process.once('SIGINT',close);
