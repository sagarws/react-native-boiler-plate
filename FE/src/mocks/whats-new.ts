import type { WhatsNewFeature } from "@/types/whats-new";

/**
 * Release notes shown on /whats-new. Ported 1:1 from TrackVid-FE `pages/WhatsNew.tsx` (`defaultFeatures`),
 * including the Hindi / Gujarati translations. Images live in `public/assets/whats-new` (same file names as
 * TrackVid's `assets/images/WhatsNewImage`). Descriptions are HTML and are sanitized before rendering.
 */
const img = (name: string): string => `/assets/whats-new/${name}.png`;

export const sampleWhatsNewFeatures: WhatsNewFeature[] = [
  {
    mainTitle: "TrackVid CMS App",
    title: "TrackVid CMS Desktop App",
    date: "2026-10-20",
    cmsAppLinks: true,
    translations: {
      title: {
        hi: "TrackVid CMS App",
        gu: "TrackVid CMS App",
      },
    },
    images: [
      {
        title: "Overview",
        description: `
                      <p>For a smoother claim process, we have developed the <strong>TrackVid CMS desktop app</strong>. Install it on your Windows PC and follow the guide to set it up.</p>
                      `,
        translations: {
          title: {
            hi: "Overview",
            gu: "Overview",
          },
          description: {
            hi: `
                      <p>Claim process को आसान बनाने के लिए हमने <strong>TrackVid CMS desktop app</strong> बनाया है। इसे अपने Windows PC पर install करें और setup के लिए guide देखें।</p>
                      `,
            gu: `
                      <p>Claim process ને સરળ બનાવવા માટે અમે <strong>TrackVid CMS desktop app</strong> બનાવ્યું છે. તેને તમારા Windows PC પર install કરો અને setup માટે guide જુઓ.</p>
                      `,
          },
        },
      },
    ],
  },
  {
    mainTitle: "Master Data - AJIO",
    title: "Master Data   - AJIO",
    translations: {
      title: {
        hi: "Master Data Feature",
        gu: "Master Data Feature"
      },
    },
    images: [
      {
        title: "Overview",
        description: `
                      <h3>Key Benefits:</h3>
                      <ul>
                      <li>Gain complete visibility into return parcel statuses.</li>
                      <li>View average delivery days per courier for returned parcels.</li>
                      <li>Analyze good vs bad returns delivered by each courier.</li>
                      <li>Make data-driven decisions to choose or switch courier partners.</li>
                      </ul>
                      `,
        translations: {
          title: {
            hi: "Step 1: Key Benefits:",
            gu: "Step 1: Key Benefits:"
          },
          description: {
            hi: `
                      <h3> मुख्य लाभ (Benefits):</h3>
                      <ul>
                      <li>सभी return पार्सलों की स्थिति पर पूरी नजर।</li>
                      <li>हर courier द्वारा भेजे गए return पार्सलों के लिए औसत डिलीवरी दिनों का विश्लेषण।</li>
                      <li> अच्छे और खराब return की तुलना हर courier partner के लिए।</li>
                      <li>किस courier partner को चुनना है इसका data-driven decision।</li>
                      </ul>
                      `,
            gu: `
                      <h3>મુખ્ય લાભ (Benefits):</h3>
                      <ul>
                      <li> દરેક return પાર્સલની સ્થિતિ પર સંપૂર્ણ દેખરેખ રાખી શકાય છે.</li>
                      <li>દરેક courier માટે return ડિલિવરીના સરેરાશ દિવસોનું એનાલિસિસ.</li>
                      <li>Courier partner દ્વારા પહોંચાડવામાં આવેલ સારા અને ખરાબ return નું તુલનાત્મક વિશ્લેષણ.</li>
                      <li>યોગ્ય courier partner પસંદ કરવા માટે data-based decision લેવાય.</li>
                      </ul>
                      `
          }
        },
        image: img("md1"),
      },
      {
        title: "Step 1: Login to the TrackVid Admin Panel",
        description: `
            <p>👉 Visit <a href="https://admin.trackvid.in/" target="_blank" rel="noopener noreferrer">https://admin.trackvid.in/</a> and log in with your admin credentials.</p>
          `,
        translations: {
          title: {
            hi: "Step 1: TrackVid Admin Panel में Login करें",
            gu: "Step 1: TrackVid Admin Panel માં Login કરો"
          },
          description: {
            hi: `
          <p>👉 लिंक पर जाएं: <a href="https://admin.trackvid.in/" target="_blank" rel="noopener noreferrer">https://admin.trackvid.in/</a> और अपने Admin Panel के क्रेडेंशियल्स से login करें।</p>
          `,
            gu: `
        <p>👉 લિંક પર જાઓ: <a href="https://admin.trackvid.in/" target="_blank" rel="noopener noreferrer">https://admin.trackvid.in/</a> અને તમારા Admin Panel ક્રેડેન્શિયલ્સથી login કરો.</p>
          `
          }
        },
        image: img("M1"),
      },
      {
        title: "Step 2: Navigate to Company Settings",
        description: `
        <ul>
          <li>Click on your company name at the top-right corner.</li>
          <li>Select <strong>Settings</strong> from the dropdown.</li>
        </ul>
      `,
        translations: {
          title: {
            hi: "Step 2: Company Settings में जाएं",
            gu: "Step 2: Company Settings પર જાઓ"
          },
          description: {
            hi: `
        <ul>
          <li>ऊपर दाईं ओर अपने कंपनी नाम पर क्लिक करें।</li>
          <li>ड्रॉपडाउन में से Settings को चुनें।</li>
        </ul>
      `,
            gu: `
        <ul>
          <li>ટોચે જમણીએ તમારા કંપની નામ પર ક્લિક કરો.</li>
          <li>Drop-down માંથી Settings પસંદ કરો.</li>
        </ul>
      `
          }
        },
        image: img("M2"),
      },
      {
        title: "Step 3: Go to Ecommerce Settings",
        description: `
            <ul>
              <li>Click on the <strong>Ecommerce Settings</strong> tab.</li>
            </ul>
          `,
        translations: {
          title: {
            hi: "Step 3: Ecommerce Settings खोलें",
            gu: "Step 3: Ecommerce Settings ખોલો"
          },
          description: {
            hi: `
            <ul>
              <li>Ecommerce Settings टैब पर क्लिक करें।.</li>
            </ul>
          `,
            gu: `
            <ul>
              <li>Ecommerce Settings ટૅબ પર ક્લિક કરો.</li>
            </ul>
          `
          }
        },
        image: img("M3"),
      },
      {
        title: "Step 4: Enable Master Data Feature",
        description: `
              <ul>
                <li>Select the "<strong>Yes</strong>" radio button for "Use Master Data feature".</li>
              </ul>
            `,
        translations: {
          title: {
            hi: "Step 4:  Use Master Data feature के लिए Yes radio बटन चुनें।",
            gu: "Step 4: Master Data Feature enable કરો"
          },
          description: {
            hi: `
         <ul>
      <li>"Use Master Data feature" के लिए Yes radio बटन चुनें।</li>
         </ul>
  `,
            gu: `
              <ul>
                <li>"Use Master Data feature" માટે Yes radio button પસંદ કરો.</li>
              </ul>
            `
          }
        },
        image: img("M4"),
      },
      {
        title: "Step 5: Enter AJIO Credentials",
        description: `
            <ul>
        <li>Input your <strong>AJIO Seller Panel Username</strong> and <strong>Password</strong>.</li>
      </ul>
    `,
        translations: {
          title: {
            hi: "Step 5: AJIO Credentials डालें",
            gu: "Step 5: AJIO Credentials દાખલ કરો"
          },
          description: {
            hi: `
            <ul>
              <li> अपना AJIO Seller Panel username और password दर्ज करें।</li>
            </ul>
          `,
            gu: `
            <ul>
              <li>તમારું AJIO Seller Panel username અને password નાખો.</li>
            </ul>
          `
          }
        },
        image: img("M5"),
      },
      {
        title: "Step 6: Save the Credentials",
        description: `
            <ul>
              <li>Click on the "<strong>Save All"</strong> button.</li>
              <li>Wait for the system to validate and sync the data.</li>
            </ul>
          `,
        translations: {
          title: {
            hi: "Step 6: Save All बटन पर क्लिक करें",
            gu: "Step 6: Save All બટન પર ક્લિક કરો"
          },
          description: {
            hi: `
              <ul>
                <li>"Save All" पर क्लिक करें।</li>
                <li>कुछ समय तक प्रतीक्षा करें ताकि सिस्टम डेटा को sync कर सके।</li>
              </ul>
            `,
            gu: `
              <ul>
                <li>"Save All" પર ક્લિક કરો.</li>
                <li>સિસ્ટમ દ્વારા sync થવા માટે થોડીવાર રાહ જુઓ.</li>
              </ul>
`
          }
        },
        image: img("M6"),
      },
      {
        title: "Step 7: Set TAT (Turnaround Time) Values",
        description: `
              <ul>
                <li>Enter platform-wise <strong>TAT period</strong> (in days) for analysis.</li>
                <li>Click "<strong>Save"</strong> again to apply the TAT settings.</li>
              </ul>
            `,
        translations: {
          title: {
            hi: "Step 7: TAT (Turnaround Time) सेट करें",
            gu: "Step 7: TAT (Turnaround Time) દાખલ કરો"
          },
          description: {
            hi: `
                <ul>
                  <li>अलग-अलग प्लेटफॉर्म के लिए TAT अवधि (दिनों में) दर्ज करें।</li>
                  <li>"Save" बटन पर क्लिक करें।</li>
                </ul>
              `,
            gu: `
              <ul>
                <li>દરેક પ્લેટફોર્મ માટે દિવસ મુજબ TAT value નાખો.</li>
                <li>"Save" બટન પર ક્લિક કરો.</li>
              </ul>
            `
          }
        },
        image: img("M7"),
      },
    ],
  },
  {
    mainTitle: "Scan Return Parcel",
      title: "Scan Return Parcel",
    translations: {
      title: {
        hi: "Scan Return Parcel",
        gu: "Scan Return Parcel"
      },
    },
    images: [
      {
        title: "Overview:-",
        description: `
  <h3>Why Mark Returns as Good or Bad?</h3>
  <p>To ensure the <strong>Master Data</strong> feature delivers precise analytics, it's essential to mark each physically received return parcel as either <strong>Good</strong> or <strong>Bad</strong>. This helps improve courier performance analysis and provides greater operational clarity within the <strong>TrackVid dashboard</strong>.</p>
`,
        translations: {
          title: {
            hi: "Step 1: TrackVid Admin Panel में Login करें",
            gu: "Step 1: TrackVid Admin Panel માં Login કરો"
          },
          description: {
            hi: `
  <h3>Master Data Feature का महत्व</h3>
  <p>Master Data feature का पूरा लाभ उठाने के लिए आपको हर <strong>फिजिकली डिलीवर हुए return पार्सल</strong> को <strong>Good</strong> या <strong>Bad</strong> की स्थिति में मार्क करना जरूरी है। इससे <strong>courier प्रदर्शन</strong> की सटीक एनालिसिस मिलती है और <strong>TrackVid dashboard</strong> में बेहतर निर्णय लिए जा सकते हैं।</p>
`,
            gu: `
  <h3>Overview (સારાંશ)</h3>
  <p><strong>Master Data feature</strong>નો સંપૂર્ણ લાભ લેવા માટે જરૂરી છે કે દરેક <strong>ફીઝિકલ ડિલીવરી થયેલા return પાર્સલ</strong>ને તમે <strong>Good</strong> કે <strong>Bad</strong> તરીકે ચિહ્નિત કરો. આથી તમને <strong>courier</strong>નું પારફોર્મન્સ એનાલિસિસમાં સ્પષ્ટતા મળે છે અને <strong>TrackVid dashboard</strong>માં યોગ્ય નિર્ણય લેવા માટે મદદરૂપ થાય છે.</p>
`
          }
        },
        image: img("b1"),
      },
      {
        title: "Step 1: Via Return Video Recording (Desktop or Mobile App)",
        description: `
                      <p>You can record return parcel videos using the <strong>TrackVid desktop app</strong> or <strong>mobile app</strong>. To mark parcels as Good or Bad during the recording:</p>
                      <ol>
                        <li>Go to <strong>TrackVid Admin Panel</strong> → <strong>Company Profile</strong> → <strong>Settings</strong> → <strong>Video Settings</strong>.</li>
                        <li>Enable the checkbox: ✅ <strong>"Show return condition pop up"</strong>.</li>
                        <li>During video recording, a popup will appear with <strong>"Good"</strong> and <strong>"Bad"</strong> buttons.</li>
                        <li>Select the condition based on the parcel's physical status.</li>
                      </ol>
                    `,
        translations: {
          title: {
            hi: "Step 1: Return Video Recording (Desktop या Mobile App से)",
            gu: "Step 1: Return Video Recording (Desktop અથવા Mobile App દ્વારા)"
          },
          description: {
            hi: `
                      <p>आप TrackVid desktop app या mobile app के ज़रिए return parcel की वीडियो रिकॉर्डिंग कर सकते हैं। वीडियो बनाते समय Parcel को Good या Bad के रूप में मार्क करने के लिए:</p>
                      <ol>
                        <li>TrackVid Admin Panel > आपकी कंपनी प्रोफाइल > Settings > Video Settings में जाएं।</strong>.</li>
                        <li>ऑप्शन: ✅ "Show return condition pop up" को Enable करें।</strong>.</li>
                        <li>अब जब आप वीडियो बनाएंगे, तो एक पॉपअप दिखेगा जिसमें Good और Bad बटन होंगे।</li>
                        <li>पार्सल की स्थिति के अनुसार संबंधित बटन पर क्लिक करें।</li>
                      </ol>
                    `,
            gu: `
                      <p>તમે TrackVid desktop app કે mobile appનો ઉપયોગ કરીને return parcel ની વિડિયો રેકોર્ડ કરી શકો છો. વિડિયો દરમિયાન Parcel ને Good કે Bad તરીકે ચિહ્નિત કરવા માટે:</p>
                      <ol>
                        <li>TrackVid Admin Panel → તમારા કંપની પ્રોફાઇલ → Settings → Video Settings પર જાઓ.</li>
                        <li>ઑપ્શન: ✅ "Show return condition pop up" ને Enable કરો.</li>
                        <li>હવે જ્યારે તમે વિડિયો બનાવશો, ત્યારે પોપઅપ આવશે જેમાં Good અને Bad બટન હશે.</li>
                        <li>Parcel ની હાલત મુજબ યોગ્ય બટન પર ક્લિક કરો.</li>
                      </ol>
                    `
          }
        },
        images: [img("sa1"), img("sa2"), img("sa3")],
      },
      {
        title: "Step 2: Bulk Update via Excel File (Good & Bad Returns)",
        description: `
          <ol>
            <li>Use this method to mark Good and Bad returns in bulk through Excel upload.</li>
            <li>Select Data Type: <strong>"Change status from 'Return-Created' to 'Return-Delivered'"</strong>.</li>
            <li>Click <strong>Import</strong> → Choose the applicable <strong>E-commerce platform</strong>.</li>
            <li>Download the <strong>template file</strong>, fill in:
              <ul>
                <li><strong>Return AWB number</strong></li>
                <li><strong>Parcel Condition</strong>: "Good" or "Bad"</li>
              </ul>
            </li>
            <li>Upload the file via <strong>Upload A File</strong>.</li>
            <li>The system will update return statuses and conditions accordingly.</li>
          </ol>
        `,
        translations: {
          title: {
            hi: "Step 2: Excel File के ज़रिए Bulk Update (Good और Bad दोनों)",
            gu: "Step 2: Excel File દ્વારા Bulk Update (Good અને Bad બંને)"
          },
          description: {
            hi: `
          <ol>
            <li>आप एक साथ कई return पार्सलों को Excel फाइल के माध्यम से Good या Bad मार्क कर सकते हैं।</li>
            <li>TrackVid Admin Panel > External Imports पर जाएं।</strong>.</li>
            <li>Data Type सेलेक्ट करें: "Change status from 'Return-Created' to 'Return-Delivered'"।</li>
            <li>Template file डाउनलोड करें और इसमें भरें:
              <ul>
                <li><strong>Return AWB number</strong></li>
                <li>Parcel Condition: "Good" या "Bad"</li>
              </ul>
            </li>
            <li>फाइल को Upload A File बटन से अपलोड करें।</li>
            <li>सिस्टम फाइल को प्रोसेस करेगा और Status व Condition अपडेट कर देगा।</li>
          </ol>
        `,
            gu: `
          <ol>
            <li>તમે એકસાથે અનેક return parcels ને Excel upload દ્વારા Good કે Bad તરીકે માર્ક કરી શકો છો.</li>
            <li>Data Type પસંદ કરો: "Change status from 'Return-Created' to 'Return-Delivered'"।</li>
            <li>Import પર ક્લિક કરો અને સંબંધિત Ecommerce platform પસંદ કરો.</li>
            <li>Template Excel File ડાઉનલોડ કરો અને તેમાં લખો:
              <ul>
                <li>Return AWB number</li>
                <li>Parcel Condition: "Good" કે "Bad"</li>
              </ul>
            </li>
            <li>આ ફાઇલને Upload A File બટનથી અપલોડ કરો.</li>
            <li>સિસ્ટમ ફાઇલને પ્રોસેસ કરીને Status અને Condition અપડેટ કરશે.</li>
          </ol>
        `,
          }
        },
        images: [img("sd1"), img("sd2"), img("sd3"), img("sd4")],
      },
      {
        title: "Step 3: Scan Return Parcels Using Barcode Scanner (Admin Panel)",
        description: `
                      <p>You can mark return parcels by scanning their barcodes without recording videos.</p>
                      <ol>
                        <li>Go to <strong>TrackVid Admin Panel</strong> → <strong>External Imports</strong>.</li>
                        <li>Click <strong>Scan Return Parcel</strong>.</li>
                        <li>Select:
                          <ul>
                            <li><strong>Good Parcel</strong> → then scan each parcel using a barcode scanner.</li>
                            <li><strong>Bad Parcel</strong> → then scan each parcel using a barcode scanner.</li>
                          </ul>
                        </li>
                      </ol>
                    `,
        translations: {
          title: {
            hi: "Step 3: Admin Panel में Barcode Scanner से स्कैन करें",
            gu: "Step 3: Admin Panel માં Barcode Scanner વડે સ્કેન કરો"
          },
          description: {
            hi: `
                <p>अगर वीडियो नहीं बना रहे हों, तो सीधे पार्सल को स्कैन करें।</p>
                <ol>
                  <li>TrackVid Admin Panel > External Imports में जाएं।</li>
                  <li>Scan Return Parcel पर क्लिक करें।</li>
                  <li>Select:
                    <ul>
                      <li>Good Parcel → अब हर पार्सल को barcode scanner से स्कैन करें।</li>
                      <li>Bad Parcel → अब हर पार्सल को barcode scanner से स्कैन करें।</li>
                    </ul>
                  </li>
                </ol>
              `,
            gu: `
                  <p>જો તમે વિડિયો બનાવી રહ્યા નથી તો Barcode Scanner થી સીધા parcels સ્કેન કરો.</p>
                  <ol>
                    <li>TrackVid Admin Panel → External Imports પર જાઓ.</li>
                    <li>Scan Return Parcel પર ક્લિક કરો.</li>
                    <li>Select:
                      <ul>
                        <li>Good Parcel → પછી દરેક parcel ને barcode scanner થી સ્કેન કરો.</li>
                        <li>Bad Parcel → પછી દરેક parcel ને barcode scanner થી સ્કેન કરો.</li>
                      </ul>
                    </li>
                  </ol>
                `,
          }
        },
        images: [img("b1"), img("b2")],
      },
      {
        title: "Step 4: Scan Return Parcels via Mobile App (Camera Scan)",
        description: `
                        <p>Quick and convenient scanning through the <strong>TrackVid mobile app</strong> using the phone camera.</p>
                        <ol>
                          <li>Open the <strong>TrackVid Mobile App</strong>.</li>
                          <li>Tap ☰ (top-left menu) → Select <strong>Scan Return Parcel</strong>.</li>
                          <li>Choose:
                            <ul>
                              <li><strong>Good Parcel</strong> → then scan each parcel using your mobile camera.</li>
                              <li><strong>Bad Parcel</strong> → then scan each parcel using your mobile camera.</li>
                            </ul>
                          </li>
                        </ol>
                      `,
        translations: {
          title: {
            hi: "Step 4: Mobile App के ज़रिए Scan करें (कैमरा द्वारा)",
            gu: "Step 4: Mobile App દ્વારા Scan કરો (ફોન કેમેરા વડે)"
          },
          description: {
            hi: `
                <p>TrackVid Mobile App का उपयोग करके फ़ोन कैमरे से स्कैन करें।</p>
                <ol>
                  <li>TrackVid Mobile App खोलें।</li>
                  <li>ऊपर बाएं ☰ मेनू पर टैप करें → Scan Return Parcel चुनें।</li>
                  <li>Choose:
                    <ul>
                      <li>Good Parcel → पार्सल को mobile camera से स्कैन करें।</li>
                      <li>Bad Parcel → पार्सल को mobile camera से स्कैन करें।</li>
                    </ul>
                  </li>
                </ol>
              `,
            gu: `
                <p>TrackVid Mobile App નો ઉપયોગ કરીને parcel ને mobile camera વડે સ્કેન કરો.</p>
                <ol>
                  <li>TrackVid Mobile App ખોલો.</li>
                  <li>ટોચના ડાબી બાજુમાં ☰ મેનુ પર ટૅપ કરો → Scan Return Parcel પસંદ કરો.</li>
                  <li>પછી:
                    <ul>
                      <li>Good Parcel → parcel ને mobile camera થી સ્કેન કરો.</li>
                      <li>Bad Parcel → parcel ને mobile camera થી સ્કેન કરો.</li>
                    </ul>
                  </li>
                </ol>
              `,
          }
        },
        images: [img("d1"), img("d2"), img("d3"), img("d4")],
      },
    ],
  },
  {
    mainTitle: "TrackVid App Login",
    title: "TrackVid App Login",
    translations: {
      title: {
        hi: " TrackVid Desktop App में Login कैसे करें",
        gu: " TrackVid Desktop App માં Login કેવી રીતે કરશો"
      },
    },
    images: [
      {
        title: "Step 1: Open TrackVid Admin Panel",
        description: `
                      <p>To begin the login process, open the TrackVid Admin Panel in any web browser.</p>
                      <p>Once opened, go to the Profile section located in the top-right corner.</p>
                    `,
        translations: {
          title: {
            hi: "Step 1: TrackVid Admin Panel खोलें",
            gu: "Step 1: TrackVid Admin Panel ખોલો"
          },
          description: {
            hi: `
                      <p>सबसे पहले login करने के लिए, किसी भी ब्राउज़र में TrackVid Admin Panel खोलें।</p>
                      <p>फिर ऊपर दाईं ओर स्थित Profile सेक्शन में जाएं।</p>
                    `,
            gu: `
                      <p>સૌપ્રથમ login કરવા માટે કોઈપણ બ્રાઉઝર દ્વારા TrackVid Admin Panel ખોલો.</p>
                      <p>તેના બાદ ઉપર જમણે આવેલા Profile વિભાગમાં જાઓ.</p>
                    `
          }
        },
        image: img("L1"),
      },
      {
        title: "Copy Your Email",
        description: `
          <p>Inside the Profile section, you will find the registered email.</p>
          <p>Copy this email and paste it into the email field of the TrackVid desktop app.</p>
        `,
        translations: {
          title: {
            hi: "Step 2: Email कॉपी करें",
            gu: "Step 2: Email કોપી કરો"
          },
          description: {
            hi: `
          <p>Profile सेक्शन में आपको रजिस्टर्ड email दिखेगा।</p>
          <p>उसे कॉपी करें और TrackVid desktop app में email field में पेस्ट करें।</p>
        `,
            gu: `
         <p>Profile વિભાગમાં તમારું રજિસ્ટર્ડ email દેખાશે.</p>
          <p>તેને કોપી કરીને TrackVid desktop app ના email field માં પેસ્ટ કરો.</p>
        `,
          }
        },
        images: [img("L2"), img("L3")],
      },
      {
        title: "Step 3: Enter Username and Password",
        description: `
                      <p>Navigate to the Feed section within the Admin Panel.</p>
                      <p>Find the relevant feed for which you want to login, and copy the username and password from there.</p>
                      <p>Now, go back to the TrackVid desktop app and paste the credentials into the login fields.</p>
                    `,
        translations: {
          title: {
            hi: "Step 3: Username और Password डालें",
            gu: "Step 3: Username અને Password દાખલ કરો"
          },
          description: {
            hi: `
                  <p>Admin Panel के Feed सेक्शन में जाएं।</p>
                      <p>जिस Feed के लिए आप login करना चाहते हैं, वहाँ से उसका username और password कॉपी करें।</p>
                      <p>अब वापस TrackVid desktop app में जाएं और इन्हें login फील्ड्स में पेस्ट करें।</p>
                `,
            gu: `
                  <p>Admin Panel ના Feed વિભાગમાં જાઓ.</p>
                      <p>જ્યાંથી સંબંધિત feed માટેનું username અને password કોપી કરો.</p>
                      <p>પછી પાછા TrackVid desktop app માં જઈને તે માહિતી login ફીલ્ડ્સમાં पેસ્ટ કરો.</p>
                `
          }
        },
        images: [img("L4"), img("L5"), img("L3")],
      },
    ],
  },
  {
    mainTitle: "Auto-Bookmark Forward...",
    title: "Auto-Bookmark Forward Videos Based on CMS Status",
    translations: {
      title: {
        hi: " TrackVid Desktop App में Login कैसे करें",
        gu: " TrackVid Desktop App માં Login કેવી રીતે કરશો"
      },
    },
    images: [
      {
        title: "ℹ️ About This Feature:",
        description: `
                <h3>This feature allows your forward videos to be automatically bookmarked based on the CMS status.</h3>
                 <ol>
                  <p>Once enabled:</p>
                  <li>Any forward video linked to a CMS entry will be marked as favorite.</li>
                      <li>These bookmarked videos will be protected from auto-deletion from the cloud until the claim is either approved or rejected.</li>
                </ol>
                  `,
        translations: {
          title: {
            hi: " ℹ️ इस Feature के बारे में जानकारी:",
            gu: " ℹ️ આ Feature વિષે માહિતી:"
          },
          description: {
            hi: `
                  <h3>यह feature आपके forward videos को CMS status के आधार पर स्वतः bookmark (favorite) कर देगा।</h3>
                 <ol>
                  <p>एक बार enable हो जाने पर:</p>
                  <li> जो भी forward video किसी CMS entry से जुड़ा होगा, वह automatic favorite हो जाएगा।</li>
                      <li>ये bookmarked videos तब तक cloud से delete नहीं होंगे, जब तक संबंधित claim को Approved या Rejected नहीं किया जाता।</li>
                </ol>
                `,
            gu: `
                  <h3>આ feature તમારા forward videos ને CMS status ના આધાર પર આપમેળે bookmark (favorite) તરીકે માર્ક કરે છે.</h3>
                 <ol>
                  <p>જ્યારે આ feature enable હશે:</p>
                  <li>કોઈ પણ forward video જે CMS entry સાથે જોડાયેલ હશે તે automatic favorite થઈ જશે.</li>
                      <li>આવા bookmarked videos ને ત્યાં સુધી cloud પરથી delete નહીં કરવામાં આવે, જ્યાં સુધી સંબંધિત claim ને Approved અથવા Rejected ના status માં અપડેટ ન કરવામાં આવે.</li>
                </ol>
                `
          }
        },
        image: img("J1"),
      },
      {
        title: "Step 1: Login to Admin Panel",
        description: `
                      <p>Login to the TrackVid Admin Panel using any web browser with your credentials.</p>
                    `,
        translations: {
          title: {
            hi: "Step 1: Admin Panel में Login करें",
            gu: "Step 1: Admin Panel માં Login કરો"
          },
          description: {
            hi: `
                      <p>किसी भी ब्राउज़र में जाकर अपने क्रेडेंशियल्स का उपयोग करके TrackVid Admin Panel में login करें।</p>
                    `,
            gu: `
                      <p>કોઈપણ બ્રાઉઝર મારફતે તમારા TrackVid Admin Panel માં login કરો.</p>
                    `
          }
        },
        image: img("L1"),
      },
      {
        title: "Step 2: Enable Auto-Bookmark Option",
        description: `
         <ol>
                  <li>Click on the Profile icon in the top-right corner.</li>
                      <li>TSelect Settings → go to Video Settings.</li>
                      <li>Locate the option: "Auto-Bookmark Forward Videos Based on CMS Status".</li>
                      <li>Select the "Yes" radio button to enable it.</li>
                </ol>
        `,
        translations: {
          title: {
            hi: "Step 2: Auto-Bookmark ऑप्शन को Enable करें",
            gu: "Step 2: Auto-Bookmark વિકલ્પ Enable કરો"
          },
          description: {
            hi: `
          <ol>
                  <li> ऊपर दाईं ओर दिए गए Profile icon पर क्लिक करें।</li>
                      <li>Settings चुनें → फिर जाएं Video Settings में।</li>
                      <li>वहाँ ऑप्शन ढूंढें: "Auto-Bookmark Forward Videos Based on CMS Status"</li>
                      <li>अब "Yes" radio बटन सिलेक्ट करें।</li>
                </ol>
        `,
            gu: `
         <ol>
                  <li> ઉપર જમણાવાડે આવેલ Profile icon પર ક્લિક કરો.</li>
                      <li> Settings પસંદ કરો → પછી Video Settings માં જાઓ.</li>
                      <li>વિકલ્પ શોધો: "Auto-Bookmark Forward Videos Based on CMS Status"</li>
                      <li>"Yes" radio બટન પસંદ કરો.</li>
                </ol>
        `,
          }
        },
        image: img("J1"),
      },
    ],
  },{
    mainTitle: "Auto Reply for AJIO",
    title: "Auto Reply for AJIO",
    translations: {
      title: {
        hi: "AJIO के लिए Auto Reply",
        gu: "AJIO માટે Auto Reply"
      },
    },
    images: [
      {
        title: "Overview",
        description: `
                      <h3>Key Benefits:</h3>
                      <ul>
                      <li>Automatically reply to customer emails from AJIO.</li>
                      <li>Use dynamic variables to personalize responses (order ID, customer name, etc.).</li>
                      <li>Save time by automating repetitive email responses.</li>
                      <li>Ensure consistent and professional communication with customers.</li>
                      <li>Track all auto-replied emails in the Email Inbox section.</li>
                      </ul>
                      `,
        translations: {
          title: {
            hi: "मुख्य लाभ (Key Benefits):",
            gu: "મુખ્ય લાભ (Key Benefits):"
          },
          description: {
            hi: `
                      <h3>मुख्य लाभ (Benefits):</h3>
                      <ul>
                      <li>AJIO से आने वाले customer emails पर automatically reply करें।</li>
                      <li>Dynamic variables का उपयोग करके personalized responses बनाएं (order ID, customer name, आदि)।</li>
                      <li>Repetitive email responses को automate करके समय बचाएं।</li>
                      <li>Customers के साथ consistent और professional communication सुनिश्चित करें।</li>
                      <li>सभी auto-replied emails को Email Inbox section में track करें।</li>
                      </ul>
                      `,
            gu: `
                      <h3>મુખ્ય લાભ (Benefits):</h3>
                      <ul>
                      <li>AJIO થી આવતા customer emails પર automatically reply કરો.</li>
                      <li>Dynamic variables નો ઉપયોગ કરીને personalized responses બનાવો (order ID, customer name, વગેરે).</li>
                      <li>Repetitive email responses ને automate કરીને સમય બચાવો.</li>
                      <li>Customers સાથે consistent અને professional communication સુનિશ્ચિત કરો.</li>
                      <li>બધા auto-replied emails ને Email Inbox section માં track કરો.</li>
                      </ul>
                      `
          }
        },
        image: img("AAR1"),
      },
      {
        title: "Step 1: Login to the TrackVid Admin Panel",
        description: `
            <p>👉 Visit <a href="https://admin.trackvid.in/" target="_blank" rel="noopener noreferrer">https://admin.trackvid.in/</a> and log in with your admin credentials.</p>
          `,
        translations: {
          title: {
            hi: "Step 1: TrackVid Admin Panel में Login करें",
            gu: "Step 1: TrackVid Admin Panel માં Login કરો"
          },
          description: {
            hi: `
          <p>👉 लिंक पर जाएं: <a href="https://admin.trackvid.in/" target="_blank" rel="noopener noreferrer">https://admin.trackvid.in/</a> और अपने Admin Panel के क्रेडेंशियल्स से login करें।</p>
          `,
            gu: `
        <p>👉 લિંક પર જાઓ: <a href="https://admin.trackvid.in/" target="_blank" rel="noopener noreferrer">https://admin.trackvid.in/</a> અને તમારા Admin Panel ક્રેડેન્શિયલ્સથી login કરો.</p>
          `
          }
        },
        image: img("M1"),
      },
      {
        title: "Step 2: Navigate to Settings",
        description: `
        <ul>
          <li>Click on your company name at the top-right corner.</li>
          <li>Select <strong>Settings</strong> from the dropdown menu.</li>
        </ul>
      `,
        translations: {
          title: {
            hi: "Step 2: Settings में जाएं",
            gu: "Step 2: Settings પર જાઓ"
          },
          description: {
            hi: `
        <ul>
          <li>ऊपर दाईं ओर अपने कंपनी नाम पर क्लिक करें।</li>
          <li>ड्रॉपडाउन menu में से <strong>Settings</strong> को चुनें।</li>
        </ul>
      `,
            gu: `
        <ul>
          <li>ટોચે જમણીએ તમારા કંપની નામ પર ક્લિક કરો.</li>
          <li>Drop-down menu માંથી <strong>Settings</strong> પસંદ કરો.</li>
        </ul>
      `
          }
        },
        image: img("AAR3"),
      },
      {
        title: "Step 3: Go to AJIO Email Auto Reply Tab",
        description: `
            <ul>
              <li>In the Settings page, click on the <strong>"AJIO Email Auto reply"</strong> tab.</li>
              <li>This will open the Integrations Settings page where you can manage email templates and mailboxes.</li>
            </ul>
          `,
        translations: {
          title: {
            hi: "Step 3: AJIO Email Auto Reply Tab खोलें",
            gu: "Step 3: AJIO Email Auto Reply Tab ખોલો"
          },
          description: {
            hi: `
            <ul>
              <li>Settings page में, <strong>"AJIO Email Auto reply"</strong> tab पर क्लिक करें।</li>
              <li>यह Integrations Settings page खोलेगा जहां आप email templates और mailboxes manage कर सकते हैं।</li>
            </ul>
          `,
            gu: `
            <ul>
              <li>Settings page માં, <strong>"AJIO Email Auto reply"</strong> tab પર ક્લિક કરો.</li>
              <li>આ Integrations Settings page ખોલશે જ્યાં તમે email templates અને mailboxes manage કરી શકો છો.</li>
            </ul>
          `
          }
        },
        image: img("AAR4"),
      },
      {
        title: "Step 4: Connect Your Email Mailbox",
        description: `
              <ul>
                <li>In the <strong>Connected Mailboxes</strong> section, click on <strong>"Add Mailbox"</strong> button.</li>
                <li>Select your email provider (Google Workspace/Gmail).</li>
                <li>Authorize TrackVid to access your email account via OAuth.</li>
                <li>Once connected, your mailbox will appear in the list with status "Connected".</li>
              </ul>
            `,
        translations: {
          title: {
            hi: "Step 4: अपना Email Mailbox Connect करें",
            gu: "Step 4: તમારું Email Mailbox Connect કરો"
          },
          description: {
            hi: `
         <ul>
      <li><strong>Connected Mailboxes</strong> section में, <strong>"Add Mailbox"</strong> button पर क्लिक करें।</li>
      <li>अपना email provider चुनें (Google Workspace/Gmail)।</li>
      <li>OAuth के माध्यम से TrackVid को अपने email account तक access देने के लिए authorize करें।</li>
      <li>Connect होने के बाद, आपका mailbox "Connected" status के साथ list में दिखाई देगा।</li>
         </ul>
  `,
            gu: `
              <ul>
                <li><strong>Connected Mailboxes</strong> section માં, <strong>"Add Mailbox"</strong> button પર ક્લિક કરો.</li>
                <li>તમારું email provider પસંદ કરો (Google Workspace/Gmail).</li>
                <li>OAuth ની મદદથી TrackVid ને તમારા email account સુધી access આપવા માટે authorize કરો.</li>
                <li>Connect થયા પછી, તમારું mailbox "Connected" status સાથે list માં દેખાશે.</li>
              </ul>
            `
          }
        },
        image: img("AAR5"),
      },
      {
        title: "Step 5: Access Template Management Section",
        description: `
            <ul>
        <li>Scroll down to the <strong>"Template Management"</strong> section.</li>
        <li>This section allows you to create and manage your auto-reply email template for AJIO.</li>
        <li>You can see the <strong>"Load Default Template"</strong> button at the top-right of this section.</li>
      </ul>
    `,
        translations: {
          title: {
            hi: "Step 5: Template Management Section खोलें",
            gu: "Step 5: Template Management Section ખોલો"
          },
          description: {
            hi: `
            <ul>
              <li><strong>"Template Management"</strong> section तक scroll down करें।</li>
              <li>यह section आपको AJIO के लिए auto-reply email template बनाने और manage करने की सुविधा देता है।</li>
              <li>आप इस section के top-right में <strong>"Load Default Template"</strong> button देख सकते हैं।</li>
            </ul>
          `,
            gu: `
            <ul>
              <li><strong>"Template Management"</strong> section સુધી scroll down કરો.</li>
              <li>આ section તમને AJIO માટે auto-reply email template બનાવવા અને manage કરવાની સુવિધા આપે છે.</li>
              <li>તમે આ section ના top-right માં <strong>"Load Default Template"</strong> button જોઈ શકો છો.</li>
            </ul>
          `
          }
        },
        image: img("AAR6"),
      },
      {
        title: "Step 6: Load or Edit Your Template",
        description: `
            <ul>
              <li>The system automatically loads your saved template if you have one, or shows the default template.</li>
              <li>If you want to reset to default, click <strong>"Load Default Template"</strong> button.</li>
              <li>Enter a <strong>Template Name</strong> (e.g., "AJIO Customer Reply Template").</li>
              <li>Edit the <strong>Body</strong> field to customize your email response.</li>
            </ul>
          `,
        translations: {
          title: {
            hi: "Step 6: Template Load या Edit करें",
            gu: "Step 6: Template Load અથવા Edit કરો"
          },
          description: {
            hi: `
              <ul>
                <li>System automatically आपका saved template load करता है (अगर available है), या default template दिखाता है।</li>
                <li>अगर आप default पर reset करना चाहते हैं, तो <strong>"Load Default Template"</strong> button पर क्लिक करें।</li>
                <li><strong>Template Name</strong> दर्ज करें (उदाहरण: "AJIO Customer Reply Template")।</li>
                <li><strong>Body</strong> field को edit करके अपना email response customize करें।</li>
              </ul>
            `,
            gu: `
              <ul>
                <li>System automatically તમારું saved template load કરે છે (જો available હોય), અથવા default template બતાવે છે.</li>
                <li>જો તમે default પર reset કરવા માંગો છો, તો <strong>"Load Default Template"</strong> button પર ક્લિક કરો.</li>
                <li><strong>Template Name</strong> નાખો (ઉદાહરણ: "AJIO Customer Reply Template").</li>
                <li><strong>Body</strong> field ને edit કરીને તમારું email response customize કરો.</li>
              </ul>
          `
          }
        },
        image: img("AAR7"),
      },
      {
        title: "Step 7: Use Variables in Your Template",
        description: `
              <ul>
                <li>Click on the <strong>info icon (ℹ️)</strong> next to the "Body" label to see available variables.</li>
                <li>Use variables in double curly braces like <code>{{variable_name}}</code> to personalize your emails.</li>
                <li>Available variables include: <code>{{sender_name}}</code>, <code>{{order_id}}</code>, <code>{{user_full_name}}</code>, <code>{{order_status}}</code>, and more.</li>
                <li>Example: "Hello {{user_full_name}}, your order {{order_id}} has been processed."</li>
              </ul>
            `,
        translations: {
          title: {
            hi: "Step 7: Template में Variables का उपयोग करें",
            gu: "Step 7: Template માં Variables નો ઉપયોગ કરો"
          },
          description: {
            hi: `
                <ul>
                  <li>"Body" label के बगल में <strong>info icon (ℹ️)</strong> पर क्लिक करें available variables देखने के लिए।</li>
                  <li>अपने emails को personalize करने के लिए double curly braces में variables का उपयोग करें जैसे <code>{{variable_name}}</code>।</li>
                  <li>Available variables में शामिल हैं: <code>{{sender_name}}</code>, <code>{{order_id}}</code>, <code>{{user_full_name}}</code>, <code>{{order_status}}</code>, और भी बहुत कुछ।</li>
                  <li>उदाहरण: "Hello {{user_full_name}}, your order {{order_id}} has been processed."</li>
                </ul>
              `,
            gu: `
              <ul>
                <li>"Body" label ની બાજુમાં <strong>info icon (ℹ️)</strong> પર ક્લિક કરો available variables જોવા માટે.</li>
                <li>તમારા emails ને personalize કરવા માટે double curly braces માં variables નો ઉપયોગ કરો જેમ કે <code>{{variable_name}}</code>.</li>
                <li>Available variables માં શામેલ છે: <code>{{sender_name}}</code>, <code>{{order_id}}</code>, <code>{{user_full_name}}</code>, <code>{{order_status}}</code>, અને વધુ.</li>
                <li>ઉદાહરણ: "Hello {{user_full_name}}, your order {{order_id}} has been processed."</li>
              </ul>
            `
          }
        },
       image: img("AAR8"),
      },
      {
        title: "Step 8: Set Template Status and Save",
        description: `
              <ul>
                <li>Select the <strong>Status</strong> dropdown and choose <strong>"Active"</strong> to enable auto-reply.</li>
                <li>Click the <strong>"Save Template"</strong> button to save your template.</li>
                <li>Once saved, you'll see a success message and the template will be automatically used for replying to AJIO customer emails.</li>
                <li>You can click <strong>"Preview"</strong> button (appears after saving) to see how the email will look with sample data.</li>
              </ul>
            `,
        translations: {
          title: {
            hi: "Step 8: Template Status Set करें और Save करें",
            gu: "Step 8: Template Status Set કરો અને Save કરો"
          },
          description: {
            hi: `
                <ul>
                  <li><strong>Status</strong> dropdown से <strong>"Active"</strong> चुनें auto-reply enable करने के लिए।</li>
                  <li>अपना template save करने के लिए <strong>"Save Template"</strong> button पर क्लिक करें।</li>
                  <li>Save होने के बाद, आपको success message दिखेगा और template automatically AJIO customer emails के reply के लिए use होगा।</li>
                  <li>आप <strong>"Preview"</strong> button (save के बाद दिखता है) पर क्लिक करके देख सकते हैं कि email sample data के साथ कैसा दिखेगा।</li>
                </ul>
              `,
            gu: `
              <ul>
                <li><strong>Status</strong> dropdown માંથી <strong>"Active"</strong> પસંદ કરો auto-reply enable કરવા માટે.</li>
                <li>તમારું template save કરવા માટે <strong>"Save Template"</strong> button પર ક્લિક કરો.</li>
                <li>Save થયા પછી, તમને success message દેખાશે અને template automatically AJIO customer emails ના reply માટે use થશે.</li>
                <li>તમે <strong>"Preview"</strong> button (save પછી દેખાય છે) પર ક્લિક કરીને જોઈ શકો છો કે email sample data સાથે કેવું દેખાશે.</li>
              </ul>
            `
          }
        },
        image: img("AAR9"),
      },
      {
        title: "Step 9: Monitor Auto-Replied Emails",
        description: `
              <ul>
                <li>Go to the <strong>"Emails"</strong> section from the main navigation menu.</li>
                <li>You can view all emails that have been automatically replied to in the <strong>"Replied"</strong> tab.</li>
                <li>Check the <strong>"Pending"</strong> tab to see emails waiting for auto-reply.</li>
                <li>Use filters like date range, mailbox, and search to find specific emails.</li>
                <li>Click on any email to expand and view the original email and the auto-reply sent.</li>
              </ul>
            `,
        translations: {
          title: {
            hi: "Step 9: Auto-Replied Emails को Monitor करें",
            gu: "Step 9: Auto-Replied Emails ને Monitor કરો"
          },
          description: {
            hi: `
                <ul>
                  <li>Main navigation menu से <strong>"Emails"</strong> section पर जाएं।</li>
                  <li>आप <strong>"Replied"</strong> tab में automatically replied सभी emails देख सकते हैं।</li>
                  <li>Auto-reply की प्रतीक्षा कर रहे emails देखने के लिए <strong>"Pending"</strong> tab check करें।</li>
                  <li>Specific emails खोजने के लिए date range, mailbox, और search जैसे filters का उपयोग करें।</li>
                  <li>Original email और sent auto-reply देखने के लिए किसी भी email पर click करें।</li>
                </ul>
              `,
            gu: `
              <ul>
                <li>Main navigation menu માંથી <strong>"Emails"</strong> section પર જાઓ.</li>
                <li>તમે <strong>"Replied"</strong> tab માં automatically replied બધા emails જોઈ શકો છો.</li>
                <li>Auto-reply ની રાહ જોઈ રહેલા emails જોવા માટે <strong>"Pending"</strong> tab check કરો.</li>
                <li>Specific emails શોધવા માટે date range, mailbox, અને search જેવા filters નો ઉપયોગ કરો.</li>
                <li>Original email અને મોકલેલ auto-reply જોવા માટે કોઈપણ email પર click કરો.</li>
              </ul>
            `
          }
        },
        image: img("AAR10"),
      },
    ],
  }
];
