import { injectable, inject } from 'inversify';
import { ServiceIdentifiers } from '../../../../container/ServiceIdentifiers';

import * as ESTree from 'estree';

import { ICryptUtils } from '../../../../interfaces/utils/ICryptUtils';
import { ICustomNodeGroup } from '../../../../interfaces/custom-nodes/ICustomNodeGroup';
import { IEncodedValue } from '../../../../interfaces/node-transformers/obfuscating-transformers/obfuscating-replacers/literal-obfuscating-replacers/IEncodedValue';
import { IEscapeSequenceEncoder } from '../../../../interfaces/utils/IEscapeSequenceEncoder';
import { IOptions } from '../../../../interfaces/options/IOptions';
import { IRandomGenerator } from '../../../../interfaces/utils/IRandomGenerator';
import { IStorage } from '../../../../interfaces/storages/IStorage';
import { IStringArrayIndexData } from '../../../../interfaces/node-transformers/obfuscating-transformers/obfuscating-replacers/literal-obfuscating-replacers/IStringArrayIndexData';

import { StringArrayEncoding } from '../../../../enums/StringArrayEncoding';

import { AbstractObfuscatingReplacer } from '../AbstractObfuscatingReplacer';
import { Nodes } from '../../../../node/Nodes';
import { Utils } from '../../../../utils/Utils';

@injectable()
export class StringLiteralObfuscatingReplacer extends AbstractObfuscatingReplacer {
    /**
     * @type {number}
     */
    private static readonly minimumLengthForStringArray: number = 3;

    /**
     * @type {number}
     */
    private static rc4KeyLength: number = 4;

    /**
     * @type {number}
     */
    private static rc4KeysCount: number = 50;

    /**
     * @type {ICryptUtils}
     */
    private readonly cryptUtils: ICryptUtils;

    /**
     * @type {IStorage<ICustomNodeGroup>}
     */
    private readonly customNodeGroupStorage: IStorage<ICustomNodeGroup>;

    /**
     * @type {IEscapeSequenceEncoder}
     */
    private readonly escapeSequenceEncoder: IEscapeSequenceEncoder;

    /**
     * @type {Map<string, ESTree.Node>}
     */
    private readonly nodesCache: Map <string, ESTree.Node> = new Map();

    /**
     * @type {IRandomGenerator}
     */
    private readonly randomGenerator: IRandomGenerator;

    /**
     * @type {string[]}
     */
    private readonly rc4Keys: string[];

    /**
     * @type {Map<string, string>}
     */
    private readonly stringLiteralHexadecimalIndexCache: Map <string, string> = new Map();

    /**
     * @type {IStorage<string>}
     */
    private readonly stringArrayStorage: IStorage<string>;

    /**
     * @param customNodeGroupStorage
     * @param stringArrayStorage
     * @param escapeSequenceEncoder
     * @param randomGenerator
     * @param cryptUtils
     * @param options
     */
    constructor (
        @inject(ServiceIdentifiers.TCustomNodeGroupStorage) customNodeGroupStorage: IStorage<ICustomNodeGroup>,
        @inject(ServiceIdentifiers.TStringArrayStorage) stringArrayStorage: IStorage<string>,
        @inject(ServiceIdentifiers.IEscapeSequenceEncoder) escapeSequenceEncoder: IEscapeSequenceEncoder,
        @inject(ServiceIdentifiers.IRandomGenerator) randomGenerator: IRandomGenerator,
        @inject(ServiceIdentifiers.ICryptUtils) cryptUtils: ICryptUtils,
        @inject(ServiceIdentifiers.IOptions) options: IOptions
    ) {
        super(options);

        this.customNodeGroupStorage = customNodeGroupStorage;
        this.stringArrayStorage = stringArrayStorage;
        this.escapeSequenceEncoder = escapeSequenceEncoder;
        this.randomGenerator = randomGenerator;
        this.cryptUtils = cryptUtils;

        this.rc4Keys = this.randomGenerator.getRandomGenerator()
            .n(
                () => this.randomGenerator.getRandomGenerator().string({
                    length: StringLiteralObfuscatingReplacer.rc4KeyLength
                }),
                StringLiteralObfuscatingReplacer.rc4KeysCount
            );
    }

    /**
     * @param hexadecimalIndex
     * @return {ESTree.Literal}
     */
    private static getHexadecimalLiteralNode (hexadecimalIndex: string): ESTree.Literal {
        const hexadecimalLiteralNode: ESTree.Literal = Nodes.getLiteralNode(hexadecimalIndex);

        hexadecimalLiteralNode.obfuscatedNode = true;

        return hexadecimalLiteralNode;
    }

    /**
     * @param literalValue
     * @return {ESTree.Literal}
     */
    private static getRc4KeyLiteralNode (literalValue: string): ESTree.Literal {
        const rc4KeyLiteralNode: ESTree.Literal = Nodes.getLiteralNode(literalValue);

        rc4KeyLiteralNode.obfuscatedNode = true;

        return rc4KeyLiteralNode;
    }

    /**
     * @param nodeValue
     * @returns {ESTree.Node}
     */
    public replace (nodeValue: string): ESTree.Node {
        const useStringArray: boolean = this.canUseStringArray(nodeValue);
        const cacheKey: string = `${nodeValue}-${String(useStringArray)}`;
        const useCacheValue: boolean = this.nodesCache.has(cacheKey) && this.options.stringArrayEncoding !== StringArrayEncoding.Rc4;

        if (useCacheValue) {
            return <ESTree.Node>this.nodesCache.get(cacheKey);
        }

        const resultNode: ESTree.Node = useStringArray
            ? this.replaceWithStringArrayCallNode(nodeValue)
            : this.replaceWithLiteralNode(nodeValue);

        this.nodesCache.set(cacheKey, resultNode);

        return resultNode;
    }

    /**
     * @param nodeValue
     * @return {boolean}
     */
    private canUseStringArray (nodeValue: string): boolean {
        return (
            this.options.stringArray &&
            nodeValue.length >= StringLiteralObfuscatingReplacer.minimumLengthForStringArray &&
            this.randomGenerator.getMathRandom() <= this.options.stringArrayThreshold
        );
    }

    /**
     * @param value
     * @param stringArrayStorageLength
     * @return {IStringArrayIndexData}
     */
    private getStringArrayHexadecimalIndex (value: string, stringArrayStorageLength: number): IStringArrayIndexData {
        if (this.stringLiteralHexadecimalIndexCache.has(value)) {
            return {
                fromCache: true,
                index: <string>this.stringLiteralHexadecimalIndexCache.get(value)
            };
        }

        const hexadecimalRawIndex: string = Utils.decToHex(stringArrayStorageLength);
        const hexadecimalIndex: string = `${Utils.hexadecimalPrefix}${hexadecimalRawIndex}`;

        this.stringLiteralHexadecimalIndexCache.set(value, hexadecimalIndex);

        return {
            fromCache: false,
            index: hexadecimalIndex
        };
    }

    /**
     * @param value
     * @returns {IEncodedValue}
     */
    private getEncodedValue (value: string): IEncodedValue {
        let encodedValue: string,
            key: string | null = null;

        switch (this.options.stringArrayEncoding) {
            case StringArrayEncoding.Rc4:
                key = this.randomGenerator.getRandomGenerator().pickone(this.rc4Keys);
                encodedValue = this.cryptUtils.btoa(this.cryptUtils.rc4(value, key));

                break;

            case StringArrayEncoding.Base64:
                encodedValue = this.cryptUtils.btoa(value);

                break;

            default:
                encodedValue = value;
        }

        return { encodedValue, key };
    }

    /**
     * @param value
     * @return {ESTree.Literal}
     */
    private replaceWithLiteralNode (value: string): ESTree.Node {
        return Nodes.getLiteralNode(
            this.escapeSequenceEncoder.encode(value, this.options.unicodeEscapeSequence)
        );
    }

    /**
     * @param value
     * @returns {ESTree.Node}
     */
    private replaceWithStringArrayCallNode (value: string): ESTree.Node {
        const { encodedValue, key }: IEncodedValue = this.getEncodedValue(value);
        const escapedValue: string = this.escapeSequenceEncoder.encode(encodedValue, this.options.unicodeEscapeSequence);

        const stringArrayStorageLength: number = this.stringArrayStorage.getLength();
        const rotatedStringArrayStorageId: string = Utils.stringRotate(this.stringArrayStorage.getStorageId(), 1);
        const stringArrayStorageCallsWrapperName: string = `_${Utils.hexadecimalPrefix}${rotatedStringArrayStorageId}`;

        const { fromCache, index }: IStringArrayIndexData = this.getStringArrayHexadecimalIndex(
            escapedValue,
            stringArrayStorageLength
        );

        if (!fromCache) {
            this.stringArrayStorage.set(stringArrayStorageLength, escapedValue);
        }

        const callExpressionArgs: (ESTree.Expression | ESTree.SpreadElement)[] = [
            StringLiteralObfuscatingReplacer.getHexadecimalLiteralNode(index)
        ];

        if (key) {
            callExpressionArgs.push(StringLiteralObfuscatingReplacer.getRc4KeyLiteralNode(
                this.escapeSequenceEncoder.encode(key, this.options.unicodeEscapeSequence)
            ));
        }

        return Nodes.getCallExpressionNode(
            Nodes.getIdentifierNode(stringArrayStorageCallsWrapperName),
            callExpressionArgs
        );
    }
}
