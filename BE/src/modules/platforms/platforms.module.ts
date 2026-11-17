import { Module } from '@nestjs/common';
import { AjioModule } from './ajio/ajio.module';
import { MyntraModule } from './myntra/myntra.module';
import { FlipkartModule } from './flipkart/flipkart.module';
import { TataCliqModule } from './tatacliq/tatacliq.module';
import { SnapdealModule } from './snapdeal/snapdeal.module';
import { DelhiveryModule } from './delhivery/delhivery.module';
import { XbeesModule } from './xbees/xbees.module';
import { MeeshoModule } from './meesho/meesho.module';
import { NykaaModule } from './nykaa/nykaa.module';

/** Platform routes, one directory per platform (LAYER 11). No platform switch lives here. */
@Module({ imports: [AjioModule, MyntraModule, FlipkartModule, TataCliqModule, SnapdealModule, DelhiveryModule, XbeesModule, MeeshoModule, NykaaModule] })
export class PlatformsModule {}
