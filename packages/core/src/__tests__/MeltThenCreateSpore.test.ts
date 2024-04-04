import { describe, expect, it, afterAll } from 'vitest';
import { BI } from '@ckb-lumos/lumos';
import { bytifyRawString, waitForMilliseconds } from '../helpers';
import { createSpore, getSporeByOutPoint, createCluster, getClusterByOutPoint } from '../api';
import { expectCellDep, expectTypeId, expectTypeCell, OutPointRecord } from './helpers';
import { getSporeOutput, popRecord, retryQuery, signAndOrSendTransaction } from './helpers';
import {
  TEST_ACCOUNTS,
  TEST_ENV,
  SPORE_OUTPOINT_RECORDS,
  cleanupRecords,
  CLUSTER_OUTPOINT_RECORDS,
  TEST_VARIABLES,
} from './shared';
import { meltThenCreateSpore } from '../api/composed/spore/meltThenCreateSpore';

describe('Spore', () => {
  const { rpc, config } = TEST_ENV;
  const { CHARLIE, ALICE } = TEST_ACCOUNTS;
  let existingSporeRecord: OutPointRecord | undefined;
  let existingClusterRecord: OutPointRecord | undefined;

  afterAll(async () => {
    await cleanupRecords({
      name: 'Spore',
    });
  }, 0);

  describe('Spore basics', () => {
    it('Create a Spore', async () => {
      if (TEST_VARIABLES.network !== 'devnet') {
        // TODO: Wait for some block times to prevent double-spend, should resolve issue#25
        await waitForMilliseconds(10000);
      }

      const { txSkeleton, outputIndex, reference } = await createSpore({
        data: {
          contentType: 'text/plain',
          content: bytifyRawString('blind box spore'),
        },
        toLock: ALICE.lock,
        fromInfos: [ALICE.address],
        config,
      });

      const spore = getSporeOutput(txSkeleton, outputIndex, config);
      expect(spore.cell!.cellOutput.lock).toEqual(ALICE.lock);
      expectTypeId(txSkeleton, outputIndex, spore.id);
      expectCellDep(txSkeleton, spore.script.cellDep);
      expectTypeCell(txSkeleton, 'output', spore.cell.cellOutput.type!);

      expect(reference).toBeDefined();
      expect(reference.referenceTarget).toEqual('none');

      const { hash } = await signAndOrSendTransaction({
        account: ALICE,
        txSkeleton,
        config,
        rpc,
        send: true,
      });

      if (hash) {
        existingSporeRecord = {
          outPoint: {
            txHash: hash,
            index: BI.from(outputIndex).toHexString(),
          },
          account: ALICE,
        };
      }
    }, 0);

    it('Create a Cluster', async () => {
      const { txSkeleton, outputIndex } = await createCluster({
        data: {
          name: 'dob cluster',
          description: 'Testing only',
        },
        fromInfos: [CHARLIE.address],
        toLock: CHARLIE.lock,
        config,
      });

      const { hash } = await signAndOrSendTransaction({
        account: CHARLIE,
        txSkeleton,
        config,
        rpc,
        send: true,
      });
      if (hash) {
        existingClusterRecord = {
          outPoint: {
            txHash: hash,
            index: BI.from(outputIndex).toHexString(),
          },
          account: CHARLIE,
        };
      }
    }, 0);

    it('Melt and Create a Spore', async () => {
      console.log('check for spore cell: ', existingSporeRecord);
      expect(existingSporeRecord).toBeDefined();
      const sporeRecord = existingSporeRecord!;
      const sporeCell = await retryQuery(() => getSporeByOutPoint(sporeRecord.outPoint, config));

      console.log('check for cluster cell: ', existingClusterRecord);
      expect(existingClusterRecord).toBeDefined();
      const clusterRecord = existingClusterRecord!;
      const clusterCell = await retryQuery(() => getClusterByOutPoint(clusterRecord.outPoint, config));
      const clusterId = clusterCell.cellOutput.type!.args;

      const { txSkeleton, outputIndex } = await meltThenCreateSpore({
        data: {
          contentType: 'text/plain',
          content: bytifyRawString('dob spore'),
          clusterId,
        },
        toLock: CHARLIE.lock,
        fromInfos: [CHARLIE.address],
        outPoint: sporeCell.outPoint!,
        changeAddress: CHARLIE.address,
        config,
      });

      const { txSkeleton: aliceSignedTxSkeleton } = await signAndOrSendTransaction({
        account: ALICE,
        txSkeleton,
        config,
        send: false,
      });
      const { hash } = await signAndOrSendTransaction({
        account: CHARLIE,
        txSkeleton: aliceSignedTxSkeleton,
        config,
        rpc,
        send: true,
      });

      if (hash) {
        SPORE_OUTPOINT_RECORDS.push({
          outPoint: {
            txHash: hash,
            index: BI.from(outputIndex).toHexString(),
          },
          account: CHARLIE,
        });
      }
    }, 90000);
  });
});
