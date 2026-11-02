export const visibilityFixture=()=>({schemaVersion:1,sessionId:'00000000-0000-4000-8000-000000000001',sequence:1,connectionStatus:'ATTACHED',sessionPhase:'ACTIVE',readings:[
  {featureId:'wiper.front.state',vehiclePartId:'wiper.front',capabilityStatus:'SUPPORTED',availabilityStatus:'UNVERIFIED',source:'MOCK',observedAt:1000,value:'OTHER',unit:null},
  ...['low','high'].map(beam=>({featureId:`light.${beam}-beam`,vehiclePartId:`light.${beam}-beam`,capabilityStatus:'SUPPORTED',availabilityStatus:'SUPPORTED',source:'MOCK',observedAt:1000,value:'OFF',unit:null})),
]});
